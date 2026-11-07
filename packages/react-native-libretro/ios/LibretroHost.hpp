#pragma once

#include <cstdint>
#include <string>

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
/** Stick analógico izquierdo, x/y en [-1, 1]. */
void setAnalog(double x, double y);
/** Estado del mando físico: máscara de botones libretro y stick izquierdo en [-1, 1]. */
void setGamepad(uint16_t buttons, double x, double y);
void reset();

bool saveState(int slot);
bool loadState(int slot);

/** Motivo del último fallo de loadCore/loadGame (cadena vacía si no hubo fallo). */
std::string lastError();
/** Texto de diagnóstico: estado de entrada de la UI y lo que pidió el core (se vacía al leer). */
std::string debugState();

/** Último frame producido. Leer bajo frame.mutex. */
FrameBuffer &frame();

}  // namespace host
