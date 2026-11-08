#include "RomInspector.hpp"

#include <cstring>

namespace romcheck {
namespace {

// Logo de Nintendo en 0x04..0x09 (GBA)
const uint8_t kGbaLogoStart[8] = {0x24, 0xFF, 0xAE, 0x51, 0x69, 0x9A, 0xA2, 0x21};

bool isGba(const uint8_t *d, size_t n) {
  if (n < 0xC0) return false;
  return std::memcmp(d + 0x04, kGbaLogoStart, 8) == 0 && d[0xB2] == 0x96;
}

// Big-endian (.z64), byte-swapped (.v64) y little-endian (.n64): cabecera PI BSD
bool isN64(const uint8_t *d, size_t n) {
  if (n < 0x40) return false;
  const bool z64 = d[0] == 0x80 && d[1] == 0x37 && d[2] == 0x12 && d[3] == 0x40;
  const bool v64 = d[0] == 0x37 && d[1] == 0x80 && d[2] == 0x40 && d[3] == 0x12;
  const bool n64 = d[0] == 0x40 && d[1] == 0x12 && d[2] == 0x37 && d[3] == 0x80;
  return z64 || v64 || n64;
}

// Mega Drive: "SEGA" en 0x100. SMD (copiadora): 0xAA 0xBB en 0x08..0x09
bool isMegaDrive(const uint8_t *d, size_t n) {
  return n >= 0x104 && std::memcmp(d + 0x100, "SEGA", 4) == 0;
}
bool isSmd(const uint8_t *d, size_t n) {
  return n >= 0x200 && d[8] == 0xAA && d[9] == 0xBB;
}

// PlayStation: identificador "PLAYSTATION" en la cabecera del sector 16 del disco.
// .iso (2048 bytes por sector): 0x8000 + 8. .bin crudo (2352 bytes por sector): 0x9300 + 16.
bool isPs1(const uint8_t *d, size_t n) {
  static const char kId[] = "PLAYSTATION";
  if (n >= 0x8008 + 11 && std::memcmp(d + 0x8008, kId, 11) == 0) return true;
  return n >= 0x9310 + 11 && std::memcmp(d + 0x9310, kId, 11) == 0;
}

}  // namespace

bool isRomExtension(const std::string &ext) {
  return ext == "gba" || ext == "agb" || ext == "bin" || ext == "z64" || ext == "n64" ||
         ext == "v64" || ext == "md" || ext == "gen" || ext == "smd" || ext == "iso" ||
         ext == "cue";
}

Kind sniff(const std::string &ext, const uint8_t *data, size_t size) {
  if (!data || size == 0) return Kind::Unknown;
  if ((ext == "gba" || ext == "agb" || ext == "bin") && isGba(data, size)) return Kind::GBA;
  if ((ext == "z64" || ext == "n64" || ext == "v64") && isN64(data, size)) return Kind::N64;
  if ((ext == "md" || ext == "gen" || ext == "bin") && isMegaDrive(data, size)) return Kind::Sega;
  if (ext == "smd" && (isSmd(data, size) || isMegaDrive(data, size))) return Kind::Sega;
  if ((ext == "iso" || ext == "bin") && isPs1(data, size)) return Kind::PS1;
  return Kind::Unknown;
}

}  // namespace romcheck
