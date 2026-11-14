#pragma once

#include <cstdint>
#include <string>

#include "FrameBuffer.hpp"

// API de alto nivel sobre Libretro.
// Solo puede haber UNA sesión activa por proceso: los cores mantienen estado global.
namespace host {

/** Directorios de sistema (BIOS), de SRAM y de save states. Llamar antes de loadCore. */
void configure(const char *systemDir, const char *saveDir, const char *stateDir);

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
/** Puntero táctil (stylus NDS): x/y en [-1, 1] sobre el frame completo del core. */
void setPointer(double x, double y, bool pressed);
/** Estado del mando físico: máscara de botones libretro y stick izquierdo en [-1, 1]. */
void setGamepad(uint16_t buttons, double x, double y);
void reset();

bool saveState(int slot);
bool loadState(int slot);

/** Motivo del último fallo de loadCore/loadGame (cadena vacía si no hubo fallo). */
std::string lastError();
/** Texto de diagnóstico: estado de entrada de la UI y lo que pidió el core (se vacía al leer). */
std::string debugState();

/** Opción de core elegida por el usuario (prioridad sobre las forzadas; se aplica en caliente). */
void setOption(const char *key, const char *value);

/** Relación de aspecto de pantalla declarada por el core (0 = desconocida). */
float aspectRatio();

/** Último frame producido. Leer bajo frame.mutex. */
FrameBuffer &frame();

}  // namespace host
