#pragma once

#include <string>

// Extracción de ROMs desde .zip: lectura del directorio central + zlib raw inflate.
// Soporta entradas 'stored' y 'deflate'. No soporta Zip64 ni cifrado.
namespace romzip {

// Carpetas de destino por consola (rutas absolutas dentro de Documents)
struct Folders {
  std::string gba;
  std::string n64;
  std::string sega;
  std::string nds;
};

/**
 * Recorre las entradas del zip con extensión de ROM, las inspecciona por contenido
 * (romcheck::sniff) y extrae la primera ROM verificada a la carpeta de su consola.
 * Si el archivo ya existe en alguna carpeta de consola no vuelve a extraerlo.
 * Devuelve la ruta de la ROM, o cadena vacía si el zip no contiene ninguna ROM verificada.
 */
std::string extractRom(const std::string &zipPath, const Folders &folders);

/**
 * Devuelve el nombre de la primera entrada con formato de otra consola (p. ej. .nds),
 * o cadena vacía si no hay ninguna. Un zip así no debe enviarse a MAME.
 */
std::string foreignEntry(const std::string &zipPath);

}  // namespace romzip
