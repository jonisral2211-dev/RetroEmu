#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

// Inspección de ROMs por contenido (cabecera), no solo por extensión.
// Necesario porque .bin puede ser GBA o Mega Drive.
namespace romcheck {

enum class Kind { Unknown, GBA, N64, Sega, PS1, NDS, Saturn, PSP, SNES, NES, GB, GBC, Dreamcast };

/** Bytes de cabecera necesarios para inspeccionar PS1 (sector 16 de un .bin crudo + margen). */
constexpr size_t kHeadSize = 0x9400;

/** Extensiones de ROM reconocidas (en minúsculas, sin punto). */
bool isRomExtension(const std::string &ext);

/**
 * Devuelve la consola de la ROM si su cabecera es válida para la extensión.
 * Unknown = no verificada: no se muestra en la biblioteca.
 */
Kind sniff(const std::string &ext, const uint8_t *data, size_t size);

}  // namespace romcheck
