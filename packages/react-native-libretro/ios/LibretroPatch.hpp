// Parches de ROM al vuelo: IPS, BPS y UPS (traducciones y ROM hacks).
// Se aplican en memoria sobre una copia de la ROM; el archivo original nunca se modifica.
// BPS y UPS comprueban el CRC32 de la ROM de origen y del resultado: si no encajan, no se carga.
#pragma once

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace jlpatch {

using Bytes = std::vector<uint8_t>;

inline uint32_t crc32(const uint8_t *p, size_t n) {
  struct Table {
    uint32_t v[256];
    Table() {
      for (uint32_t i = 0; i < 256; i++) {
        uint32_t c = i;
        for (int k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
        v[i] = c;
      }
    }
  };
  static const Table table;
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < n; i++) crc = table.v[(crc ^ p[i]) & 0xFFu] ^ (crc >> 8);
  return crc ^ 0xFFFFFFFFu;
}

inline uint32_t readLE32(const uint8_t *p) {
  return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
}

// Lector acotado: cualquier lectura fuera del rango marca ok = false.
struct Reader {
  const uint8_t *data;
  size_t limit;
  size_t pos;
  bool ok = true;

  uint8_t byte() {
    if (pos >= limit) {
      ok = false;
      return 0;
    }
    return data[pos++];
  }

  // Entero variable de BPS/UPS (codificación del formato de byuu)
  uint64_t varint() {
    uint64_t value = 0, shift = 1;
    for (;;) {
      const uint8_t x = byte();
      if (!ok) return 0;
      value += uint64_t(x & 0x7F) * shift;
      if (x & 0x80) break;
      shift <<= 7;
      value += shift;
    }
    return value;
  }
};

// IPS: registros offset/tamaño (tamaño 0 = RLE) y EOF; un truncado opcional al final.
inline bool applyIps(const Bytes &patch, Bytes &rom, std::string &err) {
  if (patch.size() < 8 || std::memcmp(patch.data(), "PATCH", 5) != 0) {
    err = "El archivo no es un parche IPS válido";
    return false;
  }
  const size_t end = patch.size();
  size_t pos = 5;
  for (;;) {
    if (pos + 3 > end) {
      err = "Parche IPS incompleto";
      return false;
    }
    if (std::memcmp(&patch[pos], "EOF", 3) == 0) {
      pos += 3;
      break;
    }
    const size_t off = (size_t(patch[pos]) << 16) | (size_t(patch[pos + 1]) << 8) | size_t(patch[pos + 2]);
    pos += 3;
    if (pos + 2 > end) {
      err = "Parche IPS incompleto";
      return false;
    }
    const size_t size = (size_t(patch[pos]) << 8) | size_t(patch[pos + 1]);
    pos += 2;
    if (size == 0) {
      if (pos + 3 > end) {
        err = "Parche IPS incompleto";
        return false;
      }
      const size_t run = (size_t(patch[pos]) << 8) | size_t(patch[pos + 1]);
      const uint8_t value = patch[pos + 2];
      pos += 3;
      if (off + run > rom.size()) rom.resize(off + run, 0);
      std::memset(&rom[off], value, run);
    } else {
      if (pos + size > end) {
        err = "Parche IPS incompleto";
        return false;
      }
      if (off + size > rom.size()) rom.resize(off + size, 0);
      std::memcpy(&rom[off], &patch[pos], size);
      pos += size;
    }
  }
  if (pos + 3 <= end) {
    const size_t newSize = (size_t(patch[pos]) << 16) | (size_t(patch[pos + 1]) << 8) | size_t(patch[pos + 2]);
    rom.resize(newSize, 0);
  }
  return true;
}

// BPS: acciones SourceRead, TargetRead, SourceCopy y TargetCopy; pie con CRC de origen, destino y parche.
inline bool applyBps(const Bytes &patch, const Bytes &src, Bytes &out, std::string &err) {
  if (patch.size() < 19 || std::memcmp(patch.data(), "BPS1", 4) != 0) {
    err = "El archivo no es un parche BPS válido";
    return false;
  }
  const size_t total = patch.size();
  const uint32_t srcCrc = readLE32(&patch[total - 12]);
  const uint32_t tgtCrc = readLE32(&patch[total - 8]);
  if (crc32(src.data(), src.size()) != srcCrc) {
    err = "La ROM no coincide con este parche BPS (CRC de origen distinto)";
    return false;
  }
  Reader r{patch.data(), total - 12, 4};
  const uint64_t srcSize = r.varint();
  const uint64_t tgtSize = r.varint();
  const uint64_t metaSize = r.varint();
  if (!r.ok || srcSize != src.size() || r.pos + metaSize > r.limit) {
    err = "Cabecera BPS no válida";
    return false;
  }
  r.pos += size_t(metaSize);

  out.assign(size_t(tgtSize), 0);
  size_t outOff = 0;
  int64_t srcRel = 0, tgtRel = 0;
  while (r.pos < r.limit) {
    const uint64_t data = r.varint();
    if (!r.ok) break;
    const uint64_t cmd = data & 3;
    const uint64_t len = (data >> 2) + 1;
    if (outOff + len > tgtSize) {
      err = "Acción BPS fuera del tamaño de salida";
      return false;
    }
    switch (cmd) {
      case 0:  // SourceRead: copia el origen en la misma posición
        for (uint64_t i = 0; i < len; i++) {
          const size_t s = outOff + size_t(i);
          out[s] = s < src.size() ? src[s] : 0;
        }
        break;
      case 1:  // TargetRead: bytes literales del parche
        if (r.pos + len > r.limit) {
          err = "Parche BPS truncado";
          return false;
        }
        std::memcpy(&out[outOff], &patch[r.pos], size_t(len));
        r.pos += size_t(len);
        break;
      case 2: {  // SourceCopy: copia desde otra posición del origen
        const uint64_t d = r.varint();
        const int64_t delta = (d & 1) ? -int64_t(d >> 1) : int64_t(d >> 1);
        srcRel += delta;
        for (uint64_t i = 0; i < len; i++) {
          if (srcRel < 0 || uint64_t(srcRel) >= src.size()) {
            err = "Referencia BPS fuera de la ROM de origen";
            return false;
          }
          out[outOff + size_t(i)] = src[size_t(srcRel)];
          srcRel++;
        }
        break;
      }
      case 3: {  // TargetCopy: copia desde lo ya escrito en la salida
        const uint64_t d = r.varint();
        const int64_t delta = (d & 1) ? -int64_t(d >> 1) : int64_t(d >> 1);
        tgtRel += delta;
        for (uint64_t i = 0; i < len; i++) {
          if (tgtRel < 0 || uint64_t(tgtRel) >= tgtSize) {
            err = "Referencia BPS fuera de la salida";
            return false;
          }
          out[outOff + size_t(i)] = out[size_t(tgtRel)];
          tgtRel++;
        }
        break;
      }
    }
    if (!r.ok) {
      err = "Parche BPS truncado";
      return false;
    }
    outOff += size_t(len);
  }
  if (outOff != tgtSize || crc32(out.data(), out.size()) != tgtCrc) {
    err = "El resultado del parche BPS no coincide (CRC)";
    return false;
  }
  return true;
}

// UPS: saltos relativos y XOR byte a byte con origen; pie con CRC de origen, destino y parche.
inline bool applyUps(const Bytes &patch, const Bytes &src, Bytes &out, std::string &err) {
  if (patch.size() < 18 || std::memcmp(patch.data(), "UPS1", 4) != 0) {
    err = "El archivo no es un parche UPS válido";
    return false;
  }
  const size_t total = patch.size();
  const uint32_t srcCrc = readLE32(&patch[total - 12]);
  const uint32_t tgtCrc = readLE32(&patch[total - 8]);
  if (crc32(src.data(), src.size()) != srcCrc) {
    err = "La ROM no coincide con este parche UPS (CRC de origen distinto)";
    return false;
  }
  Reader r{patch.data(), total - 12, 4};
  const uint64_t srcSize = r.varint();
  const uint64_t tgtSize = r.varint();
  if (!r.ok || srcSize != src.size()) {
    err = "Cabecera UPS no válida";
    return false;
  }
  // El origen se extiende con ceros hasta el tamaño del destino
  out = src;
  out.resize(size_t(tgtSize), 0);
  uint64_t off = 0;
  while (r.pos < r.limit) {
    off += r.varint();
    if (!r.ok) {
      err = "Parche UPS truncado";
      return false;
    }
    for (;;) {
      const uint8_t x = r.byte();
      if (!r.ok) {
        err = "Parche UPS truncado";
        return false;
      }
      if (x == 0) break;
      if (off >= tgtSize) {
        err = "Referencia UPS fuera de la salida";
        return false;
      }
      out[size_t(off)] ^= x;
      off++;
    }
    off++;  // el 0 de cierre marca un byte sin cambios
  }
  if (crc32(out.data(), out.size()) != tgtCrc) {
    err = "El resultado del parche UPS no coincide (CRC)";
    return false;
  }
  return true;
}

// ext en minúsculas: "ips", "bps" o "ups". `out` recibe la ROM parcheada.
inline bool apply(const std::string &ext, const Bytes &patch, const Bytes &in, Bytes &out, std::string &err) {
  if (ext == "ips") {
    out = in;
    return applyIps(patch, out, err);
  }
  if (ext == "bps") return applyBps(patch, in, out, err);
  if (ext == "ups") return applyUps(patch, in, out, err);
  err = "Formato de parche no soportado: " + ext;
  return false;
}

}  // namespace jlpatch
