#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

// Descompresión en streaming de .zip (stored/deflate, Zip64) y .7z (LZMA/LZMA2 con el LZMA SDK).
// Nunca carga el archivo entero en memoria: una ISO de PSP de 1,8 GB dentro de un .7z se
// descomprime por bloques de 1 MB directamente al disco.
namespace unpack {

struct Result {
  std::vector<std::string> files;  // rutas absolutas extraídas (o ya existentes) en destDir
  std::string error;               // vacío si todo fue bien
};

/**
 * Extrae a destDir (sin subcarpetas) todos los archivos de juego del comprimido: se ignoran
 * textos, imágenes y carpetas. Un archivo que ya existe en destDir no se sobrescribe.
 * Cada archivo se escribe primero como ".<nombre>.part" y se renombra al terminar, así una
 * extracción interrumpida no deja juegos a medias en la biblioteca.
 */
Result extractAll(const std::string &archivePath, const std::string &destDir);

/**
 * Nombres de las entradas de un .zip leyendo solo el índice final (sin cargar el archivo en
 * memoria; sirve para zips de varios GB). Vacío si no es un zip válido.
 */
/**
 * Como extractAll pero conservando las subcarpetas y todos los archivos (.exe, .ini…): para
 * ports como Quake (id1/pak0.pak) o Cave Story (Doukutsu.exe + data/).
 */
Result extractTree(const std::string &archivePath, const std::string &destDir);

std::vector<std::string> listZipEntries(const std::string &zipPath);

/** true si el archivo es un .7z (por firma, no por extensión). */
bool is7z(const std::string &path);

/** Entrada de un comprimido vista sin extraerlo: nombre, tamaño, CRC32 del índice y cabecera. */
struct PeekEntry {
  std::string name;           // ruta dentro del comprimido
  uint64_t size = 0;          // tamaño descomprimido
  uint32_t crc = 0;           // CRC32 que guarda el índice (0 si no lo trae)
  std::vector<uint8_t> head;  // primeros bytes descomprimidos (vacío si no se pudo leer)
};

/**
 * Inspecciona un .zip o .7z sin extraerlo al disco: lista sus archivos (sin carpetas ni basura) y
 * descomprime en memoria solo la cabecera de cada uno (headBytes(nombre) bytes; 0 = no leerla).
 * En un .7z sólido solo se leen cabeceras dentro de los primeros 96 MB de cada bloque.
 * Devuelve false si no es un comprimido válido (motivo en error).
 */
bool peekArchive(const std::string &path, const std::function<size_t(const std::string &name)> &headBytes,
                 std::vector<PeekEntry> &entries, std::string &error);

}  // namespace unpack
