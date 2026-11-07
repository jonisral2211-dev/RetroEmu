#pragma once

#include <cstdint>

#include "FrameBuffer.hpp"

// API de alto nivel sobre Libretro.
// Solo puede haber UNA sesión activa por proceso: los cores mantienen estado global.
namespace host {

/** Directorios de sistema (BIOS) y de guardado. Llamar antes de loadCore. */
void configure(const char *systemDir, const char *saveDir);

/** dlopen del framework del core y resolución de la API de Libretro. */
bool loadCore(const char *frameworkBinaryPath);

/** Carga la ROM con el core activo. Persiste la SRAM del juego anterior. */
bool loadGame(const char *romPath);
void unloadGame();

void start();
void stop();  // para el hilo de emulación y persiste la SRAM
void setPaused(bool paused);
void setButtons(uint16_t mask);
void reset();

bool saveState(int slot);
bool loadState(int slot);

/** Último frame producido. Leer bajo frame.mutex. */
FrameBuffer &frame();

}  // namespace host
