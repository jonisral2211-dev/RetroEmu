#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>

#include "RomInspector.hpp"

// Identificación completa de un juego por su contenido: consola (romcheck::sniff + discos y CHD),
// código de producto (serial) y título interno de la cabecera.
//   PS1:  SYSTEM.CNF del disco (BOOT = cdrom:\SLUS_007.54;1 -> SLUS-00754)
//   PSP:  UMD_DATA.BIN o PSP_GAME/PARAM.SFO (DISC_ID / TITLE); .pbp: su PARAM.SFO
//   N64:  código NUS-NSME y título en 0x20 (cualquier orden de bytes: z64/v64/n64)
//   GBA:  AGB-XXXX y título en 0xA0 · NDS: NTR-XXXX y título en 0x00
//   GB/GBC: título en 0x134 · SNES: cabecera interna LoROM/HiROM validada por checksum
//   Mega Drive / Mega-CD: serial en 0x180, título en 0x150 · Saturn: IP.BIN (+0x20 / +0x60)
// No modifica romcheck::sniff (la biblioteca sigue usando las mismas reglas de siempre).
namespace romid {

struct Info {
  std::string console;  // carpeta de Documents: gba, n64, ps1, psp…; vacío = no reconocido
  std::string serial;   // código de producto normalizado (SLUS-00754, ULUS-10041, NUS-NSME…)
  std::string title;    // título interno de la cabecera (puede venir vacío)
};

/** Lee n bytes en offset; false si no hay tantos (fin de archivo o fuera de la cabecera). */
using Reader = std::function<bool(uint64_t offset, uint8_t *out, size_t n)>;

/** Identifica por extensión (minúsculas, sin punto) y contenido. size = tamaño total del archivo. */
Info identify(const std::string &ext, const Reader &read, uint64_t size);

/** Lector sobre un búfer en memoria (cabecera extraída de un .zip/.7z). */
Reader bufferReader(const uint8_t *data, size_t size);

/** Lector sobre un archivo (FILE* abierto en modo binario; no se cierra). */
Reader fileReader(FILE *f);

/** Consola de un romcheck::Kind como carpeta de Documents ('' si Unknown). */
std::string folderOf(romcheck::Kind kind);

/** Tipo de CHD por sus metadatos: "psp" (DVD), "dreamcast" (GD-ROM), "cd" (PS1/Saturn/Mega-CD), "" si no es CHD. */
std::string chdType(const Reader &read);

}  // namespace romid
