#include "RomIdentify.hpp"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <vector>

namespace romid {
namespace {

uint32_t le32(const uint8_t *p) {
  return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
}
uint64_t be64(const uint8_t *p) {
  uint64_t v = 0;
  for (int i = 0; i < 8; ++i) v = (v << 8) | p[i];
  return v;
}

// Texto ASCII imprimible de una cabecera: sin nulos ni espacios repetidos
std::string cleanText(const uint8_t *p, size_t n) {
  std::string out;
  bool space = false;
  for (size_t i = 0; i < n; ++i) {
    const unsigned char c = p[i];
    if (c == 0) break;
    if (c < 0x20 || c > 0x7E) {
      space = !out.empty();
      continue;
    }
    if (c == ' ') {
      space = !out.empty();
      continue;
    }
    if (space) out += ' ';
    space = false;
    out += char(c);
  }
  return out;
}

bool isAlnumCode(const std::string &s) {
  if (s.empty()) return false;
  return std::all_of(s.begin(), s.end(), [](char c) { return std::isalnum(static_cast<unsigned char>(c)) != 0; });
}

std::string upper(std::string s) {
  for (auto &c : s) c = char(std::toupper(static_cast<unsigned char>(c)));
  return s;
}

// ---- ISO 9660 (PS1, PSP y discos en general) --------------------------------------------------
// Sector de 2048 bytes (.iso) o crudo de 2352 (.bin): datos en +16 (modo 1) o +24 (modo 2 XA, PS1)
struct Iso {
  const Reader *read = nullptr;
  uint32_t sectorSize = 0;
  uint32_t dataOffset = 0;

  bool open(const Reader &r) {
    read = &r;
    struct Layout {
      uint32_t size, off;
    };
    for (const Layout l : {Layout{2048, 0}, Layout{2352, 24}, Layout{2352, 16}}) {
      uint8_t pvd[6];
      if (r(uint64_t(16) * l.size + l.off, pvd, 6) && pvd[0] == 1 && std::memcmp(pvd + 1, "CD001", 5) == 0) {
        sectorSize = l.size;
        dataOffset = l.off;
        return true;
      }
    }
    return false;
  }

  bool readSector(uint32_t lba, uint8_t *out) const {
    return (*read)(uint64_t(lba) * sectorSize + dataOffset, out, 2048);
  }

  // Lee hasta maxBytes de un archivo (extensión contigua) a partir de su LBA
  bool readExtent(uint32_t lba, uint32_t size, uint32_t maxBytes, std::vector<uint8_t> &out) const {
    const uint32_t want = std::min(size, maxBytes);
    out.clear();
    out.reserve(want);
    uint8_t sec[2048];
    for (uint32_t done = 0; done < want; done += 2048, ++lba) {
      if (!readSector(lba, sec)) return !out.empty();
      out.insert(out.end(), sec, sec + std::min<uint32_t>(2048, want - done));
    }
    return true;
  }

  // Busca un nombre (sin ";1", sin mayúsculas/minúsculas) en un directorio
  bool findIn(uint32_t dirLba, uint32_t dirSize, const std::string &name, uint32_t &lba, uint32_t &size, bool &isDir) const {
    std::vector<uint8_t> dir;
    if (!readExtent(dirLba, dirSize, 64 * 1024, dir)) return false;
    size_t p = 0;
    while (p < dir.size()) {
      const uint8_t len = dir[p];
      if (len == 0) {  // relleno hasta el siguiente sector
        p = (p / 2048 + 1) * 2048;
        continue;
      }
      if (p + 33 > dir.size() || p + len > dir.size()) break;
      const uint8_t nameLen = dir[p + 32];
      if (p + 33 + nameLen > dir.size()) break;
      std::string entry(reinterpret_cast<const char *>(&dir[p + 33]), nameLen);
      const auto semi = entry.find(';');
      if (semi != std::string::npos) entry.resize(semi);
      if (!entry.empty() && entry.back() == '.') entry.pop_back();
      if (upper(entry) == upper(name)) {
        lba = le32(&dir[p + 2]);
        size = le32(&dir[p + 10]);
        isDir = (dir[p + 25] & 0x02) != 0;
        return true;
      }
      p += len;
    }
    return false;
  }

  // Lee un archivo por ruta ("PSP_GAME/PARAM.SFO") hasta maxBytes
  bool readFile(const std::string &path, uint32_t maxBytes, std::vector<uint8_t> &out) const {
    uint8_t pvd[2048];
    if (!readSector(16, pvd)) return false;
    uint32_t lba = le32(pvd + 156 + 2);
    uint32_t size = le32(pvd + 156 + 10);
    size_t start = 0;
    while (start < path.size()) {
      const size_t slash = path.find('/', start);
      const std::string part = path.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
      bool isDir = false;
      if (!findIn(lba, size, part, lba, size, isDir)) return false;
      if (slash == std::string::npos) return !isDir && readExtent(lba, size, maxBytes, out);
      if (!isDir) return false;
      start = slash + 1;
    }
    return false;
  }

  std::string systemId() const {
    uint8_t pvd[2048];
    if (!readSector(16, pvd)) return "";
    return cleanText(pvd + 8, 32);
  }
};

// "BOOT = cdrom:\SLUS_007.54;1" -> "SLUS-00754"
std::string serialFromSystemCnf(const std::vector<uint8_t> &cnf) {
  const std::string text(cnf.begin(), cnf.end());
  std::string up = upper(text);
  size_t at = up.find("BOOT");
  if (at == std::string::npos) return "";
  size_t colon = up.find(':', at);
  if (colon == std::string::npos) return "";
  size_t p = colon + 1;
  while (p < up.size() && (up[p] == '\\' || up[p] == '/')) ++p;
  // Algunos discos anteponen una carpeta ("cdrom:\GAME\SLES_123.45")
  size_t end = p;
  while (end < up.size() && up[end] != ';' && up[end] != '\r' && up[end] != '\n' && up[end] != ' ') ++end;
  std::string file = up.substr(p, end - p);
  const auto slash = file.find_last_of("\\/");
  if (slash != std::string::npos) file = file.substr(slash + 1);
  std::string letters, digits;
  for (char c : file) {
    if (std::isalpha(static_cast<unsigned char>(c)) && digits.empty()) letters += c;
    else if (std::isdigit(static_cast<unsigned char>(c))) digits += c;
  }
  if (letters.size() != 4 || digits.size() < 3) return "";
  return letters + "-" + digits;
}

// PARAM.SFO (PSP / PBP): DISC_ID y TITLE
void readSfo(const std::vector<uint8_t> &sfo, std::string &discId, std::string &title) {
  if (sfo.size() < 20 || std::memcmp(sfo.data(), "\0PSF", 4) != 0) return;
  const uint32_t keyTable = le32(&sfo[8]);
  const uint32_t dataTable = le32(&sfo[12]);
  const uint32_t count = le32(&sfo[16]);
  for (uint32_t i = 0; i < count && 20 + (i + 1) * 16 <= sfo.size(); ++i) {
    const uint8_t *e = &sfo[20 + i * 16];
    const uint32_t keyOff = uint32_t(e[0] | (e[1] << 8));
    const uint32_t len = le32(e + 4);
    const uint32_t dataOff = le32(e + 12);
    if (keyTable + keyOff >= sfo.size() || dataTable + dataOff + len > sfo.size()) continue;
    const std::string key(reinterpret_cast<const char *>(&sfo[keyTable + keyOff]));
    const std::string value = cleanText(&sfo[dataTable + dataOff], len);
    if (key == "DISC_ID") discId = value;
    if (key == "TITLE") title = value;
  }
}

// "ULUS10041" -> "ULUS-10041"
std::string dashSerial(std::string s) {
  s = upper(s);
  if (s.size() == 9 && s.find('-') == std::string::npos && isAlnumCode(s)) return s.substr(0, 4) + "-" + s.substr(4);
  return s;
}

void identifyPs1(const Iso &iso, Info &info) {
  std::vector<uint8_t> cnf;
  if (iso.readFile("SYSTEM.CNF", 4096, cnf)) info.serial = serialFromSystemCnf(cnf);
}

void identifyPsp(const Iso &iso, Info &info) {
  std::vector<uint8_t> umd;
  if (iso.readFile("UMD_DATA.BIN", 256, umd)) {
    const std::string text(umd.begin(), umd.end());
    const std::string id = text.substr(0, text.find('|'));
    if (id.size() >= 9 && id.size() <= 10) info.serial = upper(id);
  }
  std::vector<uint8_t> sfo;
  if (iso.readFile("PSP_GAME/PARAM.SFO", 64 * 1024, sfo)) {
    std::string disc, title;
    readSfo(sfo, disc, title);
    if (info.serial.empty() && !disc.empty()) info.serial = dashSerial(disc);
    info.title = title;
  }
}

// N64: los primeros 0x40 bytes en orden big-endian (.z64) sea cual sea el volcado
bool n64Header(const Reader &read, uint8_t out[0x40]) {
  if (!read(0, out, 0x40)) return false;
  if (out[0] == 0x37 && out[1] == 0x80) {  // .v64: pares de bytes intercambiados
    for (int i = 0; i < 0x40; i += 2) std::swap(out[i], out[i + 1]);
  } else if (out[0] == 0x40 && out[1] == 0x12) {  // .n64: little-endian por palabras
    for (int i = 0; i < 0x40; i += 4) {
      std::swap(out[i], out[i + 3]);
      std::swap(out[i + 1], out[i + 2]);
    }
  }
  return out[0] == 0x80 && out[1] == 0x37;
}

// SNES: cabecera interna (LoROM 0x7FC0 / HiROM 0xFFC0, +512 si hay cabecera de copiadora)
// validada por checksum + complemento = 0xFFFF
std::string snesTitle(const Reader &read, uint64_t size) {
  const uint64_t copier = (size % 1024) == 512 ? 512 : 0;
  for (uint64_t base : {uint64_t(0x7FC0), uint64_t(0xFFC0), uint64_t(0x40FFC0)}) {
    uint8_t h[32];
    if (!read(copier + base, h, sizeof h)) continue;
    const uint16_t complement = uint16_t(h[0x1C] | (h[0x1D] << 8));
    const uint16_t checksum = uint16_t(h[0x1E] | (h[0x1F] << 8));
    if (uint16_t(complement ^ checksum) == 0xFFFF) return cleanText(h, 21);
  }
  return "";
}

// Mega Drive / Mega-CD / Saturn / Dreamcast: cabecera de texto Sega
void identifySegaHeader(const Reader &read, uint64_t base, Info &info) {
  uint8_t h[0x200];
  if (!read(base, h, sizeof h)) return;
  // Mega Drive: título nacional 0x120, internacional 0x150, serial 0x180 ("GM 00001009-00")
  if (std::memcmp(h + 0x100, "SEGA", 4) == 0) {
    std::string serial = cleanText(h + 0x180, 14);
    if (serial.size() > 3 && serial[2] == ' ') serial = serial.substr(0, 2) + serial.substr(3);
    info.serial = serial;
    info.title = cleanText(h + 0x150, 48);
    if (info.title.empty()) info.title = cleanText(h + 0x120, 48);
  }
}

void identifySaturn(const Reader &read, Info &info) {
  for (uint64_t base : {uint64_t(0), uint64_t(0x10)}) {
    uint8_t ip[0x100];
    if (!read(base, ip, sizeof ip) || std::memcmp(ip, "SEGA SEGASATURN", 15) != 0) continue;
    info.serial = cleanText(ip + 0x20, 10);
    info.title = cleanText(ip + 0x60, 112);
    return;
  }
}

}  // namespace

Reader bufferReader(const uint8_t *data, size_t size) {
  return [data, size](uint64_t offset, uint8_t *out, size_t n) {
    if (offset > size || n > size - offset) return false;
    std::memcpy(out, data + offset, n);
    return true;
  };
}

Reader fileReader(FILE *f) {
  return [f](uint64_t offset, uint8_t *out, size_t n) {
#if defined(_WIN32)
    if (_fseeki64(f, int64_t(offset), SEEK_SET) != 0) return false;
#else
    if (fseeko(f, off_t(offset), SEEK_SET) != 0) return false;
#endif
    return std::fread(out, 1, n, f) == n;
  };
}

std::string folderOf(romcheck::Kind kind) {
  switch (kind) {
    case romcheck::Kind::GBA: return "gba";
    case romcheck::Kind::N64: return "n64";
    case romcheck::Kind::Sega: return "sega";
    case romcheck::Kind::PS1: return "ps1";
    case romcheck::Kind::NDS: return "nds";
    case romcheck::Kind::Saturn: return "saturn";
    case romcheck::Kind::PSP: return "psp";
    case romcheck::Kind::SNES: return "snes";
    case romcheck::Kind::NES: return "nes";
    case romcheck::Kind::GB: return "gb";
    case romcheck::Kind::GBC: return "gbc";
    case romcheck::Kind::Dreamcast: return "dreamcast";
    default: return "";
  }
}

std::string chdType(const Reader &read) {
  uint8_t d[64];
  if (!read(0, d, sizeof d) || std::memcmp(d, "MComprHD", 8) != 0) return "";
  const uint32_t version = (uint32_t(d[12]) << 24) | (uint32_t(d[13]) << 16) | (uint32_t(d[14]) << 8) | d[15];
  uint64_t meta = version >= 5 ? be64(d + 48) : be64(d + 36);
  for (int i = 0; i < 32 && meta != 0; ++i) {
    uint8_t e[16];
    if (!read(meta, e, sizeof e)) break;
    if (std::memcmp(e, "DVD ", 4) == 0) return "psp";
    if (std::memcmp(e, "CHGD", 4) == 0 || std::memcmp(e, "CHGT", 4) == 0) return "dreamcast";
    if (std::memcmp(e, "CHT2", 4) == 0 || std::memcmp(e, "CHTR", 4) == 0 || std::memcmp(e, "CHCD", 4) == 0) break;
    meta = be64(e + 8);
  }
  return "cd";
}

Info identify(const std::string &ext, const Reader &read, uint64_t size) {
  Info info;
  if (ext == "chd") {
    const std::string t = chdType(read);
    if (t == "psp" || t == "dreamcast") info.console = t;
    else if (t == "cd") info.console = "ps1";  // CD comprimido: PS1 salvo que su carpeta diga otra cosa
    return info;
  }
  if (ext == "pbp") {
    uint8_t h[0x28];
    if (!read(0, h, sizeof h) || std::memcmp(h, "\0PBP", 4) != 0) return info;
    info.console = "psp";
    const uint32_t sfoAt = le32(h + 8), iconAt = le32(h + 12);
    if (iconAt > sfoAt && iconAt - sfoAt < 64 * 1024) {
      std::vector<uint8_t> sfo(iconAt - sfoAt);
      if (read(sfoAt, sfo.data(), sfo.size())) {
        std::string disc, title;
        readSfo(sfo, disc, title);
        info.serial = dashSerial(disc);
        info.title = title;
      }
    }
    return info;
  }

  // Cabecera para las reglas de siempre (romcheck::sniff)
  const size_t headLen = size_t(std::min<uint64_t>(size, romcheck::kHeadSize));
  std::vector<uint8_t> head(headLen);
  if (headLen == 0 || !read(0, head.data(), headLen)) return info;
  romcheck::Kind kind = romcheck::sniff(ext, head.data(), head.size());

  // Discos que sniff no ve por su offset (PS1 en .bin crudo modo 2, .img): se mira el ISO 9660
  Iso iso;
  const bool disc = ext == "iso" || ext == "bin" || ext == "img";
  const bool hasIso = disc && iso.open(read);
  if (kind == romcheck::Kind::Unknown && hasIso) {
    const std::string sys = iso.systemId();
    if (sys == "PLAYSTATION") kind = romcheck::Kind::PS1;
    else if (sys == "PSP GAME") kind = romcheck::Kind::PSP;
  }
  info.console = folderOf(kind);

  switch (kind) {
    case romcheck::Kind::PS1:
      if (hasIso) identifyPs1(iso, info);
      break;
    case romcheck::Kind::PSP:
      if (hasIso) identifyPsp(iso, info);
      break;
    case romcheck::Kind::GBA:
      if (head.size() >= 0xB0) {
        info.title = cleanText(&head[0xA0], 12);
        const std::string code = cleanText(&head[0xAC], 4);
        if (code.size() == 4 && isAlnumCode(code)) info.serial = "AGB-" + code;
      }
      break;
    case romcheck::Kind::NDS:
      if (head.size() >= 0x10) {
        info.title = cleanText(&head[0], 12);
        const std::string code = cleanText(&head[0x0C], 4);
        if (code.size() == 4 && isAlnumCode(code)) info.serial = "NTR-" + code;
      }
      break;
    case romcheck::Kind::N64: {
      uint8_t h[0x40];
      if (n64Header(read, h)) {
        info.title = cleanText(h + 0x20, 20);
        const std::string code = cleanText(h + 0x3B, 4);
        if (code.size() == 4 && isAlnumCode(code)) info.serial = "NUS-" + code;
      }
      break;
    }
    case romcheck::Kind::GB:
    case romcheck::Kind::GBC:
      if (head.size() >= 0x150) info.title = cleanText(&head[0x134], 15);
      break;
    case romcheck::Kind::SNES:
      info.title = snesTitle(read, size);
      break;
    case romcheck::Kind::Sega:
      // Cartucho (0) o Mega-CD (sector 0 de .iso 2048, o tras 16 bytes de sincronía en .bin crudo)
      identifySegaHeader(read, 0, info);
      if (info.serial.empty() && head.size() >= 0x10 + 14 && std::memcmp(&head[0x10], "SEGADISCSYSTEM", 14) == 0) {
        identifySegaHeader(read, 0x10, info);
      }
      break;
    case romcheck::Kind::Saturn:
      identifySaturn(read, info);
      break;
    default:
      break;
  }
  return info;
}

}  // namespace romid
