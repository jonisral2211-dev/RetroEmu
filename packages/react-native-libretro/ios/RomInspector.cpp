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

// Nintendo DS: el mismo logo de Nintendo que GBA, pero en 0xC0 de la cabecera
// Mega-CD / Sega CD: "SEGADISCSYSTEM" al inicio del sector 0 (.iso/.bin 2048) o tras los 16 bytes
// de sincronía y cabecera de un .bin crudo (2352)
bool isSegaCd(const uint8_t *d, size_t n) {
  static const char kTag[] = "SEGADISCSYSTEM";
  for (size_t off : {size_t(0), size_t(0x10)}) {
    if (n >= off + 14 && std::memcmp(d + off, kTag, 14) == 0) return true;
  }
  return false;
}

// Game Boy / Color: logo de Nintendo en 0x104; 0x143 = 0x80 (compatible GBC) o 0xC0 (solo GBC)
const uint8_t kGbLogoStart[8] = {0xCE, 0xED, 0x66, 0x66, 0xCC, 0x0D, 0x00, 0x0B};

bool hasGbLogo(const uint8_t *d, size_t n) {
  return n >= 0x150 && std::memcmp(d + 0x104, kGbLogoStart, 8) == 0;
}

// NES: cabecera iNES / NES 2.0 ("NES\x1A"), UNIF ("UNIF") y Famicom Disk System ("FDS\x1A" o
// la cabecera de disco "\x01*NINTENDO-HVC*" sin la de 16 bytes)
bool isNes(const uint8_t *d, size_t n) { return n >= 16 && std::memcmp(d, "NES\x1A", 4) == 0; }
bool isUnif(const uint8_t *d, size_t n) { return n >= 32 && std::memcmp(d, "UNIF", 4) == 0; }
bool isFds(const uint8_t *d, size_t n) {
  if (n >= 16 && std::memcmp(d, "FDS\x1A", 4) == 0) return true;
  return n >= 15 && d[0] == 0x01 && std::memcmp(d + 1, "*NINTENDO-HVC*", 14) == 0;
}

bool isNds(const uint8_t *d, size_t n) {
  return n >= 0xC8 && std::memcmp(d + 0xC0, kGbaLogoStart, 8) == 0;
}

// Sega Saturn: "SEGA SEGASATURN " al inicio del sector 0 (.iso 2048) o tras la cabecera de
// sincronía de 16 bytes (.bin crudo 2352)
bool isSaturn(const uint8_t *d, size_t n) {
  static const char kId[] = "SEGA SEGASATURN";
  if (n >= 15 && std::memcmp(d, kId, 15) == 0) return true;
  return n >= 0x10 + 15 && std::memcmp(d + 0x10, kId, 15) == 0;
}

// PSP: ISO UMD con "PSP GAME" como identificador de sistema; .cso ("CISO"); .pbp ("\0PBP")
bool isPspIso(const uint8_t *d, size_t n) {
  return n >= 0x8008 + 8 && std::memcmp(d + 0x8008, "PSP GAME", 8) == 0;
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
         ext == "cue" || ext == "chd" || ext == "nds" || ext == "cso" || ext == "pbp" ||
         ext == "sms" || ext == "gg" || ext == "sg" || ext == "sfc" || ext == "smc" || ext == "fig" ||
         ext == "swc" || ext == "nes" || ext == "fds" || ext == "unf" || ext == "unif" || ext == "gb" ||
         ext == "gbc" || ext == "dmg" || ext == "sgb";
}

Kind sniff(const std::string &ext, const uint8_t *data, size_t size) {
  if (!data || size == 0) return Kind::Unknown;
  if (ext == "nds" && isNds(data, size)) return Kind::NDS;
  if (ext == "cso" && size >= 4 && std::memcmp(data, "CISO", 4) == 0) return Kind::PSP;
  if (ext == "pbp" && size >= 4 && std::memcmp(data, "\0PBP", 4) == 0) return Kind::PSP;
  // Discos: Saturn y PSP antes que PS1/Mega Drive (sus cabeceras no se solapan)
  if ((ext == "iso" || ext == "bin") && isSaturn(data, size)) return Kind::Saturn;
  if (ext == "iso" && isPspIso(data, size)) return Kind::PSP;
  if ((ext == "gba" || ext == "agb" || ext == "bin") && isGba(data, size)) return Kind::GBA;
  if ((ext == "z64" || ext == "n64" || ext == "v64") && isN64(data, size)) return Kind::N64;
  if ((ext == "md" || ext == "gen" || ext == "bin") && isMegaDrive(data, size)) return Kind::Sega;
  if (ext == "smd" && (isSmd(data, size) || isMegaDrive(data, size))) return Kind::Sega;
  // Master System, Game Gear y SG-1000 (Genesis Plus GX): muchas ROMs japonesas no llevan la
  // cabecera "TMR SEGA", así que basta la extensión
  if (ext == "sms" || ext == "gg" || ext == "sg") return Kind::Sega;
  // Super Nintendo (Snes9x): la cabecera interna está en 0x7FC0/0xFFC0 (+512 con cabecera de
  // copiadora) y no siempre es fiable; basta la extensión y un tamaño mínimo de ROM
  if ((ext == "sfc" || ext == "smc" || ext == "fig" || ext == "swc") && size >= 0x8000) return Kind::SNES;
  // NES / Famicom Disk System (FCEUmm)
  if (ext == "nes" && isNes(data, size)) return Kind::NES;
  if ((ext == "unf" || ext == "unif") && isUnif(data, size)) return Kind::NES;
  if (ext == "fds" && isFds(data, size)) return Kind::NES;
  // Game Boy / Game Boy Color (Gambatte): el indicador CGB decide la carpeta
  if (ext == "gb" || ext == "gbc" || ext == "dmg" || ext == "sgb") {
    if (hasGbLogo(data, size) && (data[0x143] & 0x80)) return Kind::GBC;
    if (hasGbLogo(data, size)) return Kind::GB;
    // Sin logo (hacks, homebrew): se respeta la extensión
    if (size >= 0x4000) return ext == "gbc" ? Kind::GBC : Kind::GB;
  }
  // Mega-CD / Sega CD (necesita la BIOS bios_CD_U.bin / _E / _J en system/)
  if ((ext == "iso" || ext == "bin") && isSegaCd(data, size)) return Kind::Sega;
  if ((ext == "iso" || ext == "bin") && isPs1(data, size)) return Kind::PS1;
  // CHD (MAME Compressed Hunks of Data): el único núcleo que los abre aquí es PCSX ReARMed
  if (ext == "chd" && size >= 8 && std::memcmp(data, "MComprHD", 8) == 0) return Kind::PS1;
  return Kind::Unknown;
}

}  // namespace romcheck
