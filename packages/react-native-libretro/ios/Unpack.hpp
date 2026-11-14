#pragma once

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
std::vector<std::string> listZipEntries(const std::string &zipPath);

/** true si el archivo es un .7z (por firma, no por extensión). */
bool is7z(const std::string &path);

}  // namespace unpack
