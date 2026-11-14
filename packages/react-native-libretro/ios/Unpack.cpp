#include "Unpack.hpp"

#include <zlib.h>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <memory>

#include "lzma/7z.h"
#include "lzma/7zCrc.h"
#include "lzma/Lzma2Dec.h"
#include "lzma/LzmaDec.h"

#if defined(_WIN32)
#define U_FSEEK _fseeki64
#define U_FTELL _ftelli64
#else
#define U_FSEEK fseeko
#define U_FTELL ftello
#endif

namespace unpack {
namespace {

constexpr size_t kChunk = 1 << 20;  // 1 MB por bloque de lectura/escritura

// ---- Utilidades -------------------------------------------------------------------

struct FileCloser {
  void operator()(FILE *f) const {
    if (f) std::fclose(f);
  }
};
using FilePtr = std::unique_ptr<FILE, FileCloser>;

std::string lowerExt(const std::string &name) {
  const auto dot = name.find_last_of('.');
  if (dot == std::string::npos) return "";
  std::string ext = name.substr(dot + 1);
  for (auto &c : ext) c = char(std::tolower(static_cast<unsigned char>(c)));
  return ext;
}

std::string baseName(const std::string &name) {
  const auto slash = name.find_last_of("/\\");
  return slash == std::string::npos ? name : name.substr(slash + 1);
}

bool exists(const std::string &path) {
  FILE *f = std::fopen(path.c_str(), "rb");
  if (!f) return false;
  std::fclose(f);
  return true;
}

// Lo que no es un juego: léeme, carátulas, webs, checksums, recursos de macOS
bool isJunk(const std::string &entryName) {
  if (entryName.find("__MACOSX/") != std::string::npos) return true;
  const std::string base = baseName(entryName);
  if (base.empty() || base[0] == '.') return true;
  static const char *const kJunk[] = {"txt", "nfo", "diz", "url", "html", "htm", "jpg", "jpeg", "png",
                                      "gif", "bmp", "webp", "pdf", "doc", "docx", "rtf", "ini", "db",
                                      "sfv", "md5", "sha1", "exe", "lnk", "torrent", "xml", "json"};
  const std::string ext = lowerExt(base);
  for (const char *j : kJunk) {
    if (ext == j) return true;
  }
  return false;
}

// Archivo de salida temporal ".<nombre>.part" que se renombra al terminar
struct OutFile {
  std::string finalPath;
  std::string partPath;
  FilePtr f;
  uint32_t crc = CRC_INIT_VAL;
  bool ok = true;

  bool open(const std::string &dir, const std::string &name) {
    finalPath = dir + "/" + name;
    partPath = dir + "/." + name + ".part";
    f.reset(std::fopen(partPath.c_str(), "wb"));
    return bool(f);
  }
  bool write(const void *data, size_t n) {
    if (!ok || !f) return false;
    crc = CrcUpdate(crc, data, n);
    ok = std::fwrite(data, 1, n, f.get()) == n;
    return ok;
  }
  void abort() {
    f.reset();
    std::remove(partPath.c_str());
  }
  bool commit() {
    if (!f) return false;
    ok = ok && std::fflush(f.get()) == 0;
    f.reset();
    if (!ok || std::rename(partPath.c_str(), finalPath.c_str()) != 0) {
      std::remove(partPath.c_str());
      return false;
    }
    return true;
  }
};

const char *kDiskFull = "No se pudo escribir el archivo extraído (¿iPhone sin espacio libre?)";

// ---- ZIP ----------------------------------------------------------------------------

uint16_t le16(const uint8_t *p) { return uint16_t(p[0] | (p[1] << 8)); }
uint32_t le32(const uint8_t *p) {
  return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
}
uint64_t le64(const uint8_t *p) { return uint64_t(le32(p)) | (uint64_t(le32(p + 4)) << 32); }

bool readAt(FILE *f, uint64_t at, void *buf, size_t n) {
  if (U_FSEEK(f, int64_t(at), SEEK_SET) != 0) return false;
  return std::fread(buf, 1, n, f) == n;
}

// Copia (stored) o inflate (deflate) en streaming desde 'at' hasta 'out'
bool zipEntryToFile(FILE *f, uint64_t at, uint16_t method, uint64_t csize, uint64_t usize, OutFile &out,
                    std::string &error) {
  if (U_FSEEK(f, int64_t(at), SEEK_SET) != 0) {
    error = "Zip dañado (posición fuera del archivo)";
    return false;
  }
  std::vector<uint8_t> in(kChunk);
  if (method == 0) {
    uint64_t left = csize;
    while (left > 0) {
      const size_t n = size_t(std::min<uint64_t>(left, kChunk));
      if (std::fread(in.data(), 1, n, f) != n) {
        error = "Zip incompleto (la descarga se cortó)";
        return false;
      }
      if (!out.write(in.data(), n)) {
        error = kDiskFull;
        return false;
      }
      left -= n;
    }
    return true;
  }
  if (method != 8) {
    error = "Este .zip usa un método de compresión no soportado (" + std::to_string(method) +
            "). Vuelve a comprimirlo como zip normal (deflate) o como .7z";
    return false;
  }
  std::vector<uint8_t> outBuf(kChunk);
  z_stream zs{};
  if (inflateInit2(&zs, -MAX_WBITS) != Z_OK) {
    error = "Sin memoria para descomprimir";
    return false;
  }
  uint64_t left = csize;
  uint64_t written = 0;
  int rc = Z_OK;
  while (rc != Z_STREAM_END) {
    if (zs.avail_in == 0) {
      if (left == 0) break;
      const size_t n = size_t(std::min<uint64_t>(left, kChunk));
      if (std::fread(in.data(), 1, n, f) != n) break;
      left -= n;
      zs.next_in = in.data();
      zs.avail_in = uInt(n);
    }
    zs.next_out = outBuf.data();
    zs.avail_out = uInt(outBuf.size());
    rc = inflate(&zs, Z_NO_FLUSH);
    if (rc != Z_OK && rc != Z_STREAM_END) break;
    const size_t produced = outBuf.size() - zs.avail_out;
    if (produced && !out.write(outBuf.data(), produced)) {
      inflateEnd(&zs);
      error = kDiskFull;
      return false;
    }
    written += produced;
  }
  inflateEnd(&zs);
  if (rc != Z_STREAM_END || written != usize) {
    error = "Zip dañado o incompleto (la descarga se cortó)";
    return false;
  }
  return true;
}

// Lee el directorio central (EOCD y Zip64 incluidos). Devuelve el número de entradas.
bool readCentralDirectory(FILE *f, uint64_t fileSize, std::vector<uint8_t> &cd, uint64_t &count, std::string &error) {
  if (fileSize < 22) {
    error = "Zip vacío o dañado";
    return false;
  }
  const size_t tailLen = size_t(std::min<uint64_t>(fileSize, 22 + 0xFFFF + 20));
  std::vector<uint8_t> tail(tailLen);
  if (!readAt(f, fileSize - tailLen, tail.data(), tailLen)) {
    error = "No se pudo leer el zip";
    return false;
  }
  size_t eocd = std::string::npos;
  for (size_t p = tailLen - 22 + 1; p-- > 0;) {
    if (le32(&tail[p]) == 0x06054b50) {
      eocd = p;
      break;
    }
  }
  if (eocd == std::string::npos) {
    error = "Zip dañado o incompleto (falta el índice final; la descarga se cortó)";
    return false;
  }
  count = le16(&tail[eocd + 10]);
  uint64_t cdSize = le32(&tail[eocd + 12]);
  uint64_t cdOffset = le32(&tail[eocd + 16]);
  if ((count == 0xFFFF || cdOffset == 0xFFFFFFFFu || cdSize == 0xFFFFFFFFu) && eocd >= 20 &&
      le32(&tail[eocd - 20]) == 0x07064b50) {
    uint8_t z64[56];
    if (readAt(f, le64(&tail[eocd - 20 + 8]), z64, sizeof z64) && le32(z64) == 0x06064b50) {
      count = le64(z64 + 32);
      cdSize = le64(z64 + 40);
      cdOffset = le64(z64 + 48);
    }
  }
  if (cdSize > (64u << 20) || cdOffset + cdSize > fileSize) {
    error = "Zip dañado (índice inválido)";
    return false;
  }
  cd.resize(static_cast<size_t>(cdSize));
  if (!readAt(f, cdOffset, cd.data(), cd.size())) {
    error = "No se pudo leer el índice del zip";
    return false;
  }
  return true;
}

Result extractZip(FILE *f, uint64_t fileSize, const std::string &destDir) {
  Result r;
  std::vector<uint8_t> cd;
  uint64_t count = 0;
  if (!readCentralDirectory(f, fileSize, cd, count, r.error)) return r;
  // 2) Entradas
  size_t p = 0;
  for (uint64_t i = 0; i < count; ++i) {
    if (p + 46 > cd.size() || le32(&cd[p]) != 0x02014b50) break;
    const uint16_t flags = le16(&cd[p + 8]);
    const uint16_t method = le16(&cd[p + 10]);
    uint64_t csize = le32(&cd[p + 20]);
    uint64_t usize = le32(&cd[p + 24]);
    const uint16_t nameLen = le16(&cd[p + 28]);
    const uint16_t extraLen = le16(&cd[p + 30]);
    const uint16_t commentLen = le16(&cd[p + 32]);
    uint64_t localOffset = le32(&cd[p + 42]);
    if (p + 46 + nameLen + extraLen > cd.size()) break;
    const std::string name(cd.begin() + long(p + 46), cd.begin() + long(p + 46 + nameLen));
    // Campo extra Zip64 (0x0001): solo trae los valores que estaban saturados, en este orden
    for (size_t e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen;) {
      const uint16_t id = le16(&cd[e]);
      const uint16_t len = le16(&cd[e + 2]);
      size_t q = e + 4;
      if (id == 0x0001) {
        if (usize == 0xFFFFFFFFu && q + 8 <= e + 4 + len) usize = le64(&cd[q]), q += 8;
        if (csize == 0xFFFFFFFFu && q + 8 <= e + 4 + len) csize = le64(&cd[q]), q += 8;
        if (localOffset == 0xFFFFFFFFu && q + 8 <= e + 4 + len) localOffset = le64(&cd[q]), q += 8;
      }
      e += 4 + len;
    }
    p += 46 + nameLen + extraLen + commentLen;

    if (name.empty() || name.back() == '/' || name.back() == '\\' || isJunk(name)) continue;
    const std::string base = baseName(name);
    const std::string target = destDir + "/" + base;
    if (exists(target)) {
      r.files.push_back(target);
      continue;
    }
    if (flags & 1) {
      r.error = "\"" + base + "\" está protegido con contraseña: no se puede extraer";
      continue;
    }
    uint8_t lh[30];
    if (!readAt(f, localOffset, lh, sizeof lh) || le32(lh) != 0x04034b50) {
      r.error = "Zip dañado (cabecera de \"" + base + "\")";
      continue;
    }
    const uint64_t dataAt = localOffset + 30 + le16(lh + 26) + le16(lh + 28);
    OutFile out;
    if (!out.open(destDir, base)) {
      r.error = kDiskFull;
      continue;
    }
    std::string err;
    if (zipEntryToFile(f, dataAt, method, csize, usize, out, err) && out.commit()) {
      r.files.push_back(target);
    } else {
      out.abort();
      r.error = err.empty() ? kDiskFull : err;
    }
  }
  return r;
}

// ---- 7z (LZMA SDK) ----------------------------------------------------------------

void *szAlloc(ISzAllocPtr, size_t size) { return size ? std::malloc(size) : nullptr; }
void szFree(ISzAllocPtr, void *address) { std::free(address); }
const ISzAlloc kAlloc = {szAlloc, szFree};

struct FileSeekStream {
  ISeekInStream vt;  // primero: el SDK nos pasa un puntero a vt
  FILE *f;
};

SRes fileRead(ISeekInStreamPtr pp, void *buf, size_t *size) {
  auto *self = reinterpret_cast<const FileSeekStream *>(pp);
  if (*size == 0) return SZ_OK;
  *size = std::fread(buf, 1, *size, self->f);
  return std::ferror(self->f) ? SZ_ERROR_READ : SZ_OK;
}

SRes fileSeek(ISeekInStreamPtr pp, Int64 *pos, ESzSeek origin) {
  auto *self = reinterpret_cast<const FileSeekStream *>(pp);
  const int whence = origin == SZ_SEEK_SET ? SEEK_SET : origin == SZ_SEEK_CUR ? SEEK_CUR : SEEK_END;
  if (U_FSEEK(self->f, *pos, whence) != 0) return SZ_ERROR_READ;
  *pos = U_FTELL(self->f);
  return SZ_OK;
}

std::string utf16ToUtf8(const std::vector<UInt16> &w) {
  std::string out;
  for (size_t i = 0; i < w.size() && w[i]; ++i) {
    uint32_t c = w[i];
    if (c >= 0xD800 && c < 0xDC00 && i + 1 < w.size() && w[i + 1] >= 0xDC00 && w[i + 1] < 0xE000) {
      c = 0x10000 + ((c - 0xD800) << 10) + (w[i + 1] - 0xDC00);
      ++i;
    }
    if (c < 0x80) {
      out += char(c);
    } else if (c < 0x800) {
      out += char(0xC0 | (c >> 6));
      out += char(0x80 | (c & 0x3F));
    } else if (c < 0x10000) {
      out += char(0xE0 | (c >> 12));
      out += char(0x80 | ((c >> 6) & 0x3F));
      out += char(0x80 | (c & 0x3F));
    } else {
      out += char(0xF0 | (c >> 18));
      out += char(0x80 | ((c >> 12) & 0x3F));
      out += char(0x80 | ((c >> 6) & 0x3F));
      out += char(0x80 | (c & 0x3F));
    }
  }
  return out;
}

const char *szMessage(SRes res) {
  switch (res) {
    case SZ_ERROR_MEM:
      return "Sin memoria suficiente para descomprimir este .7z";
    case SZ_ERROR_UNSUPPORTED:
      return "Este .7z usa un método no soportado. Vuelve a comprimirlo con LZMA2 o usa .zip";
    case SZ_ERROR_CRC:
      return "El .7z está dañado (error de CRC)";
    case SZ_ERROR_INPUT_EOF:
      return "El .7z está incompleto (la descarga se cortó)";
    case SZ_ERROR_NO_ARCHIVE:
      return "No es un archivo .7z válido";
    default:
      return "El .7z está dañado o no se pudo leer";
  }
}

constexpr UInt32 kCopy = 0;
constexpr UInt32 kLzma2 = 0x21;
constexpr UInt32 kLzma = 0x30101;
// Un bloque con filtros especiales (BCJ2, PPMd…) se descomprime en memoria solo si es pequeño
constexpr uint64_t kInMemoryMax = 256ull << 20;

// Descomprime un bloque (folder) LZMA/LZMA2/copia en streaming hacia 'sink'
SRes decodeFolderStreaming(const CSzArEx &db, UInt32 fi, FILE *f,
                           const std::function<bool(const uint8_t *, size_t)> &sink, bool &handled) {
  handled = false;
  const Byte *data = db.db.CodersData + db.db.FoCodersOffsets[fi];
  CSzData sd{data, db.db.FoCodersOffsets[fi + 1] - db.db.FoCodersOffsets[fi]};
  CSzFolder folder;
  if (SzGetNextFolderItem(&folder, &sd) != SZ_OK) return SZ_ERROR_ARCHIVE;
  if (folder.NumCoders != 1 || folder.NumPackStreams != 1) return SZ_OK;  // no soportado aquí
  const CSzCoderInfo &coder = folder.Coders[0];
  if (coder.MethodID != kCopy && coder.MethodID != kLzma && coder.MethodID != kLzma2) return SZ_OK;
  handled = true;

  const UInt32 ps = db.db.FoStartPackStreamIndex[fi];
  const uint64_t packOffset = db.dataPos + db.db.PackPositions[ps];
  uint64_t packLeft = db.db.PackPositions[ps + 1] - db.db.PackPositions[ps];
  uint64_t outLeft = SzAr_GetFolderUnpackSize(&db.db, fi);
  if (U_FSEEK(f, int64_t(packOffset), SEEK_SET) != 0) return SZ_ERROR_INPUT_EOF;

  std::vector<uint8_t> in(kChunk);
  std::vector<uint8_t> out(kChunk);
  const Byte *props = data + coder.PropsOffset;

  if (coder.MethodID == kCopy) {
    while (outLeft > 0) {
      const size_t n = size_t(std::min<uint64_t>(outLeft, kChunk));
      if (std::fread(in.data(), 1, n, f) != n) return SZ_ERROR_INPUT_EOF;
      if (!sink(in.data(), n)) return SZ_ERROR_WRITE;
      outLeft -= n;
    }
    return SZ_OK;
  }

  const bool lzma2 = coder.MethodID == kLzma2;
  CLzmaDec dec1;
  CLzma2Dec dec2;
  SRes res;
  if (lzma2) {
    if (coder.PropsSize != 1) return SZ_ERROR_UNSUPPORTED;
    Lzma2Dec_CONSTRUCT(&dec2);
    res = Lzma2Dec_Allocate(&dec2, props[0], &kAlloc);
    if (res != SZ_OK) return res;
    Lzma2Dec_Init(&dec2);
  } else {
    LzmaDec_CONSTRUCT(&dec1);
    res = LzmaDec_Allocate(&dec1, props, coder.PropsSize, &kAlloc);
    if (res != SZ_OK) return res;
    LzmaDec_Init(&dec1);
  }

  size_t inPos = 0;
  size_t inLen = 0;
  res = SZ_OK;
  while (outLeft > 0) {
    if (inPos == inLen && packLeft > 0) {
      const size_t n = size_t(std::min<uint64_t>(packLeft, kChunk));
      inLen = std::fread(in.data(), 1, n, f);
      if (inLen == 0) {
        res = SZ_ERROR_INPUT_EOF;
        break;
      }
      packLeft -= inLen;
      inPos = 0;
    }
    SizeT outLen = SizeT(std::min<uint64_t>(outLeft, kChunk));
    SizeT srcLen = inLen - inPos;
    ELzmaStatus status;
    res = lzma2 ? Lzma2Dec_DecodeToBuf(&dec2, out.data(), &outLen, in.data() + inPos, &srcLen, LZMA_FINISH_ANY,
                                       &status)
                : LzmaDec_DecodeToBuf(&dec1, out.data(), &outLen, in.data() + inPos, &srcLen, LZMA_FINISH_ANY,
                                      &status);
    inPos += srcLen;
    if (res != SZ_OK) break;
    if (outLen > 0) {
      if (!sink(out.data(), outLen)) {
        res = SZ_ERROR_WRITE;
        break;
      }
      outLeft -= outLen;
    } else if (srcLen == 0) {
      // Sin avance: o falta entrada (archivo truncado) o el flujo terminó antes de tiempo
      res = SZ_ERROR_INPUT_EOF;
      break;
    }
  }
  if (lzma2) {
    Lzma2Dec_Free(&dec2, &kAlloc);
  } else {
    LzmaDec_Free(&dec1, &kAlloc);
  }
  return res;
}

Result extract7z(FILE *f, const std::string &destDir) {
  Result r;
  static bool crcReady = false;
  if (!crcReady) {
    CrcGenerateTable();
    crcReady = true;
  }
  FileSeekStream stream{};
  stream.vt.Read = fileRead;
  stream.vt.Seek = fileSeek;
  stream.f = f;
  CLookToRead2 look;
  LookToRead2_CreateVTable(&look, False);
  std::vector<Byte> lookBuf(1 << 18);
  look.buf = lookBuf.data();
  look.bufSize = lookBuf.size();
  look.realStream = &stream.vt;
  LookToRead2_INIT(&look);

  CSzArEx db;
  SzArEx_Init(&db);
  SRes res = SzArEx_Open(&db, &look.vt, &kAlloc, &kAlloc);
  if (res != SZ_OK) {
    SzArEx_Free(&db, &kAlloc);
    r.error = szMessage(res);
    return r;
  }

  for (UInt32 fi = 0; fi < db.db.NumFolders; ++fi) {
    // Archivos de este bloque, en el orden en que aparecen en el flujo descomprimido
    struct Item {
      UInt32 index;
      uint64_t size;
      std::string name;
      bool wanted;
    };
    std::vector<Item> items;
    bool anyWanted = false;
    for (UInt32 i = db.FolderToFile[fi]; i < db.FolderToFile[fi + 1]; ++i) {
      if (db.FileToFolder[i] != fi) continue;
      const size_t len = SzArEx_GetFileNameUtf16(&db, i, nullptr);
      std::vector<UInt16> w(len);
      SzArEx_GetFileNameUtf16(&db, i, w.data());
      const std::string full = utf16ToUtf8(w);
      const std::string base = baseName(full);
      Item it{i, SzArEx_GetFileSize(&db, i), base, false};
      if (!SzArEx_IsDir(&db, i) && !isJunk(full) && it.size > 0) {
        if (exists(destDir + "/" + base)) {
          r.files.push_back(destDir + "/" + base);
        } else {
          it.wanted = true;
          anyWanted = true;
        }
      }
      items.push_back(std::move(it));
    }
    if (!anyWanted) continue;

    // Reparte el flujo del bloque entre sus archivos
    size_t cur = 0;
    uint64_t curLeft = items.empty() ? 0 : items[0].size;
    OutFile out;
    std::string blockError;
    auto beginItem = [&]() -> bool {
      while (cur < items.size() && items[cur].size == 0) ++cur;
      if (cur >= items.size()) return true;
      curLeft = items[cur].size;
      if (items[cur].wanted && !out.open(destDir, items[cur].name)) {
        blockError = kDiskFull;
        return false;
      }
      return true;
    };
    auto finishItem = [&]() -> bool {
      const Item &it = items[cur];
      if (it.wanted) {
        const bool crcOk = !SzBitWithVals_Check(&db.CRCs, it.index) ||
                           CRC_GET_DIGEST(out.crc) == db.CRCs.Vals[it.index];
        if (!crcOk) {
          out.abort();
          blockError = std::string("\"") + it.name + "\" está dañado dentro del .7z (error de CRC)";
        } else if (out.commit()) {
          r.files.push_back(destDir + "/" + it.name);
        } else {
          out.abort();
          blockError = kDiskFull;
          return false;
        }
        out = OutFile();
      }
      ++cur;
      return beginItem();
    };
    if (!beginItem()) {
      r.error = blockError;
      continue;
    }
    auto sink = [&](const uint8_t *data, size_t n) -> bool {
      while (n > 0 && cur < items.size()) {
        const size_t take = size_t(std::min<uint64_t>(n, curLeft));
        if (items[cur].wanted && !out.write(data, take)) {
          blockError = kDiskFull;
          return false;
        }
        data += take;
        n -= take;
        curLeft -= take;
        if (curLeft == 0 && !finishItem()) return false;
      }
      return true;
    };

    bool handled = false;
    res = decodeFolderStreaming(db, fi, f, sink, handled);
    if (!handled) {
      // Bloque con filtros: solo en memoria y si es pequeño
      const uint64_t unpackSize = SzAr_GetFolderUnpackSize(&db.db, fi);
      if (unpackSize > kInMemoryMax) {
        res = SZ_ERROR_UNSUPPORTED;
      } else {
        Byte *buf = static_cast<Byte *>(std::malloc(size_t(unpackSize ? unpackSize : 1)));
        if (!buf) {
          res = SZ_ERROR_MEM;
        } else {
          res = SzAr_DecodeFolder(&db.db, fi, &look.vt, db.dataPos, buf, size_t(unpackSize), &kAlloc);
          if (res == SZ_OK && !sink(buf, size_t(unpackSize))) res = SZ_ERROR_WRITE;
          std::free(buf);
        }
      }
    }
    if (out.f) out.abort();
    if (res != SZ_OK) r.error = blockError.empty() ? szMessage(res) : blockError;
    else if (!blockError.empty()) r.error = blockError;
  }
  SzArEx_Free(&db, &kAlloc);
  return r;
}

}  // namespace

std::vector<std::string> listZipEntries(const std::string &zipPath) {
  std::vector<std::string> names;
  FilePtr f(std::fopen(zipPath.c_str(), "rb"));
  if (!f) return names;
  U_FSEEK(f.get(), 0, SEEK_END);
  const uint64_t size = uint64_t(U_FTELL(f.get()));
  std::vector<uint8_t> cd;
  uint64_t count = 0;
  std::string error;
  if (!readCentralDirectory(f.get(), size, cd, count, error)) return names;
  size_t p = 0;
  for (uint64_t i = 0; i < count && p + 46 <= cd.size() && le32(&cd[p]) == 0x02014b50; ++i) {
    const uint16_t nameLen = le16(&cd[p + 28]);
    const uint16_t extraLen = le16(&cd[p + 30]);
    const uint16_t commentLen = le16(&cd[p + 32]);
    if (p + 46 + nameLen > cd.size()) break;
    names.emplace_back(cd.begin() + long(p + 46), cd.begin() + long(p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

bool is7z(const std::string &path) {
  FilePtr f(std::fopen(path.c_str(), "rb"));
  uint8_t sig[6] = {};
  if (!f || std::fread(sig, 1, 6, f.get()) != 6) return false;
  static const uint8_t k7z[6] = {'7', 'z', 0xBC, 0xAF, 0x27, 0x1C};
  return std::memcmp(sig, k7z, 6) == 0;
}

Result extractAll(const std::string &archivePath, const std::string &destDir) {
  FilePtr f(std::fopen(archivePath.c_str(), "rb"));
  if (!f) return {{}, "No se pudo abrir el archivo comprimido"};
  U_FSEEK(f.get(), 0, SEEK_END);
  const uint64_t size = uint64_t(U_FTELL(f.get()));
  U_FSEEK(f.get(), 0, SEEK_SET);
  if (is7z(archivePath)) return extract7z(f.get(), destDir);
  uint8_t sig[4] = {};
  if (!readAt(f.get(), 0, sig, 4)) return {{}, "Archivo vacío o dañado"};
  if (std::memcmp(sig, "PK", 2) != 0) {
    if (std::memcmp(sig, "Rar!", 4) == 0) return {{}, "Los .rar no están soportados: usa .zip o .7z"};
    return {{}, "No es un .zip ni un .7z válido"};
  }
  return extractZip(f.get(), size, destDir);
}

}  // namespace unpack
