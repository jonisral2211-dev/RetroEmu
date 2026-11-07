#pragma once

#include <map>
#include <string>

// Extracción de ROMs desde .zip (lectura del directorio central + zlib raw inflate).
// Soporta entradas 'stored' y 'deflate'. No soporta Zip64 ni cifrado.
namespace romzip {

/**
 * Busca en `zipPath` la primera entrada cuya extensión esté en `extToDir`
 * (p. ej. "gba" -> "/.../gba") y la extrae en esa carpeta con su nombre base.
 * Si el archivo ya existe no vuelve a extraerlo.
 * Devuelve la ruta de la ROM, o cadena vacía si el zip no contiene ninguna ROM conocida.
 */
std::string extractRom(const std::string &zipPath,
                       const std::map<std::string, std::string> &extToDir);

}  // namespace romzip
