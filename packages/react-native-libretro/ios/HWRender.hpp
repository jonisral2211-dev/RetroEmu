#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

// Contexto de render por GPU para los núcleos que piden RETRO_ENVIRONMENT_SET_HW_RENDER (OpenGL ES):
// Dreamcast (Flycast), Quake II, SwanStation con PGXP, PPSSPP/N64 con resolución interna alta.
// El núcleo dibuja en un framebuffer propio (FBO); cada frame se lee (glReadPixels) al mismo
// búfer BGRA que usan los núcleos por software, así la vista Metal, la TV y las capturas no cambian.
// Todas las funciones se llaman con el contexto actual en el hilo que las usa (makeCurrent).
namespace hwgl {

/** Crea el contexto (ES3, o ES2 si no hay) y un FBO de w×h. Deja el contexto actual. */
bool create(unsigned width, unsigned height, bool depth, bool stencil, std::string &error);
/** Hace actual el contexto en el hilo que llama (el de emulación o, al descargar, el de JS). */
void makeCurrent();
/** Redimensiona el FBO si el núcleo pide un tamaño mayor (cambio de resolución interna). */
void resize(unsigned width, unsigned height);
/** FBO en el que debe dibujar el núcleo (get_current_framebuffer). */
uintptr_t framebuffer();
/** Dirección de una función GL (get_proc_address). */
void *procAddress(const char *symbol);
/** Lee w×h píxeles del FBO a BGRA8 (dstStride bytes por fila), girando si el origen es abajo. */
void readFrame(unsigned width, unsigned height, uint8_t *dst, size_t dstStride, bool bottomLeftOrigin);
/** Libera el FBO y el contexto. */
void destroy();
bool active();

}  // namespace hwgl
