#include "RomArchive.hpp"

#include <zlib.h>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <vector>

#include "RomInspector.hpp"

namespace romzip {
namespace {

uint16_t u16(const std::vector<uint8_t> &b, size_t at) {
  return uint16_t(b[at] | (b[at + 1] << 8));
}

uint32_t u32(const std::vector<uint8_t> &b, size_t at) {
  return uint32_t(b[at]) | (uint32_t(b[at + 1]) << 8) | (uint32_t(b[at + 2]) << 16) |
         (uint32_t(b[at + 3]) << 24);
}

std::string lowerExt(const std::string &name) {
  const auto dot = name.find_last_of('.');
  const auto slash = name.find_last_of('/');
  if (dot == std::string::npos || (slash != std::string::npos && dot < slash)) return "";
  std::string ext = name.substr(dot + 1);
  for (auto &c : ext) c = char(std::tolower(static_cast<unsigned char>(c)));
  return ext;
}

std::string baseName(const std::string &name) {
  const auto slash = name.find_last_of('/');
  return slash == std::string::npos ? name : name.substr(slash + 1);
}

bool readAll(const std::string &path, std::vector<uint8_t> &out) {
  std::ifstream f(path, std::ios::binary | std::ios::ate);
  if (!f) return false;
  const std::streamsize size = f.tellg();
  f.seekg(0);
  out.resize(size_t(size));
  f.read(reinterpret_cast<char *>(out.data()), size);
  return bool(f);
}

bool fileExists(const std::string &path) {
  FILE *f = std::fopen(path.c_str(), "rb");
  if (!f) return false;
  std::fclose(f);
  return true;
}

// Descomprime una entrada local (stored o deflate). Falla si el formato no es válido.
bool inflateEntry(const std::vector<uint8_t> &zip, size_t dataAt, uint16_t method,
                  uint32_t csize, uint32_t usize, std::vector<uint8_t> &out) {
  if (dataAt + csize > zip.size()) return false;
  out.resize(usize);
  if (method == 0) {  // stored
    if (csize != usize) return false;
    std::copy(zip.begin() + dataAt, zip.begin() + dataAt + csize, out.begin());
    return true;
  }
  if (method != 8) return false;  // solo deflate

  z_stream zs{};
  if (inflateInit2(&zs, -MAX_WBITS) != Z_OK) return false;  // raw deflate
  zs.next_in = const_cast<Bytef *>(reinterpret_cast<const Bytef *>(zip.data() + dataAt));
  zs.avail_in = csize;
  zs.next_out = out.data();
  zs.avail_out = usize;
  const int rc = inflate(&zs, Z_FINISH);
  inflateEnd(&zs);
  return rc == Z_STREAM_END && zs.total_out == usize;
}

std::string folderFor(romcheck::Kind kind, const Folders &f) {
  switch (kind) {
    case romcheck::Kind::GBA:
      return f.gba;
    case romcheck::Kind::N64:
      return f.n64;
    case romcheck::Kind::Sega:
      return f.sega;
    case romcheck::Kind::NDS:
      return f.nds;
    default:
      return "";
  }
}

}  // namespace

std::string extractRom(const std::string &zipPath, const Folders &folders) {
  std::vector<uint8_t> zip;
  if (!readAll(zipPath, zip) || zip.size() < 22) return "";

  // 1) End Of Central Directory (firma 0x06054b50), buscada desde el final
  size_t eocd = std::string::npos;
  const size_t minPos = zip.size() > 22 + 0xFFFF ? zip.size() - 22 - 0xFFFF : 0;
  for (size_t p = zip.size() - 22 + 1; p-- > minPos;) {
    if (u32(zip, p) == 0x06054b50) {
      eocd = p;
      break;
    }
  }
  if (eocd == std::string::npos) return "";

  const uint16_t count = u16(zip, eocd + 10);
  const uint32_t cdOffset = u32(zip, eocd + 16);

  // 2) Directorio central: cada entrada con extensión de ROM se inspecciona por contenido
  size_t p = cdOffset;
  for (uint16_t i = 0; i < count; ++i) {
    if (p + 46 > zip.size() || u32(zip, p) != 0x02014b50) return "";
    const uint16_t method = u16(zip, p + 10);
    const uint32_t csize = u32(zip, p + 20);
    const uint32_t usize = u32(zip, p + 24);
    const uint16_t nameLen = u16(zip, p + 28);
    const uint16_t extraLen = u16(zip, p + 30);
    const uint16_t commentLen = u16(zip, p + 32);
    const uint32_t localOffset = u32(zip, p + 42);
    if (p + 46 + nameLen > zip.size()) return "";
    const std::string name(zip.begin() + p + 46, zip.begin() + p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.empty() || name.back() == '/') continue;
    const std::string ext = lowerExt(name);
    if (!romcheck::isRomExtension(ext)) continue;
    const std::string base = baseName(name);

    // Ya importada en alguna carpeta de consola: no descomprimir otra vez
    for (const std::string *dir : {&folders.gba, &folders.n64, &folders.sega}) {
      const std::string existing = *dir + "/" + base;
      if (fileExists(existing)) return existing;
    }

    // 3) Cabecera local (firma 0x04034b50) y descompresión para inspeccionar el contenido
    if (localOffset + 30 > zip.size() || u32(zip, localOffset) != 0x04034b50) continue;
    const uint16_t lNameLen = u16(zip, localOffset + 26);
    const uint16_t lExtraLen = u16(zip, localOffset + 28);
    const size_t dataAt = localOffset + 30 + lNameLen + lExtraLen;

    std::vector<uint8_t> data;
    if (!inflateEntry(zip, dataAt, method, csize, usize, data)) continue;

    const romcheck::Kind kind = romcheck::sniff(ext, data.data(), data.size());
    const std::string dir = folderFor(kind, folders);
    if (dir.empty()) continue;  // ROM no verificada: se ignora

    const std::string target = dir + "/" + base;
    std::ofstream out(target, std::ios::binary);
    if (!out) continue;
    out.write(reinterpret_cast<const char *>(data.data()), std::streamsize(data.size()));
    if (out) return target;
  }
  return "";
}

std::string foreignEntry(const std::string &zipPath) {
  // Consolas o formatos que ningún core de RetroEmu puede ejecutar (p. ej. juegos de Nintendo DS)
  static const char *const kForeign[] = {"nds", "3ds", "cia", "iso", "cso", "chd", "pbp", "gcm",
                                         "rvz", "wbfs", "nsp", "xci", "nes", "sfc", "smc", "gb",
                                         "gbc", "gg", "sms", "pce", "a26", "a78", "lnx", "ngp",
                                         "ws", "wsc", "vb"};
  std::vector<uint8_t> zip;
  if (!readAll(zipPath, zip) || zip.size() < 22) return "";

  size_t eocd = std::string::npos;
  const size_t minPos = zip.size() > 22 + 0xFFFF ? zip.size() - 22 - 0xFFFF : 0;
  for (size_t p = zip.size() - 22 + 1; p-- > minPos;) {
    if (u32(zip, p) == 0x06054b50) {
      eocd = p;
      break;
    }
  }
  if (eocd == std::string::npos) return "";

  const uint16_t count = u16(zip, eocd + 10);
  size_t p = u32(zip, eocd + 16);
  for (uint16_t i = 0; i < count; ++i) {
    if (p + 46 > zip.size() || u32(zip, p) != 0x02014b50) return "";
    const uint16_t nameLen = u16(zip, p + 28);
    const uint16_t extraLen = u16(zip, p + 30);
    const uint16_t commentLen = u16(zip, p + 32);
    if (p + 46 + nameLen > zip.size()) return "";
    const std::string name(zip.begin() + p + 46, zip.begin() + p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.empty() || name.back() == '/') continue;
    const std::string ext = lowerExt(name);
    for (const char *f : kForeign) {
      if (ext == f) return name;
    }
  }
  return "";
}

}  // namespace romzip
