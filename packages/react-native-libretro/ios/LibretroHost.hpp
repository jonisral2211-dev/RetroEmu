#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "FrameBuffer.hpp"

struct retro_memory_map;

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
/** Zona táctil de mirar de los shooters: stick derecho (-1..1). */
void setLook(double x, double y);
/** Ruta del archivo de estado de una ranura del juego cargado. */
std::string statePathFor(int slot);
/** Rebobina ~seconds (capturas cada 0,5 s). Devuelve los segundos retrocedidos (0 = nada). */
double rewind(double seconds);
/** Segundos de rebobinado disponibles; -1 si está desactivado para este juego. */
double rewindAvailable();
/** Activa estos códigos de truco (reemplaza los anteriores). false si el núcleo no admite trucos. */
bool setCheats(const std::vector<std::string> &codes);
/** Puntero táctil (stylus NDS): x/y en [-1, 1] sobre el frame completo del core. */
void setPointer(double x, double y, bool pressed);
/** Estado del mando físico: máscara de botones libretro y stick izquierdo en [-1, 1]. */
void setGamepad(uint16_t buttons, double x, double y);
/** Stick derecho (x/y en [-1, 1]) y gatillos analógicos L2/R2 (0..1) del mando físico. */
void setGamepadExtra(double rx, double ry, double l2, double r2);
/** Vibración que pide el core por puerto (0..1 por motor). Se llama desde el hilo de emulación. */
void setRumbleHandler(void (*handler)(unsigned port, float strong, float weak));
/** Estado completo de un mando físico en el puerto 0 (Jugador 1) o 1 (Jugador 2). */
void setGamepadPort(int port, uint16_t buttons, double x, double y, double rx, double ry, double l2, double r2);
/** Netplay: crea sala en el puerto (anfitrión = Jugador 1). */
bool netHost(int port);
/** Netplay: se une a la sala de otro iPhone por IP (Jugador 2). */
bool netJoin(const char *address, int port);
/** Netplay a distancia: crea sala en el servidor relay; el código aparece en netStatus(). */
bool netHostRelay(const char *relayHost, int relayPort);
/** Netplay a distancia: entra en la sala con su código de 6 caracteres. */
bool netJoinCode(const char *code, const char *relayHost, int relayPort);
void netStop();
/** "fase|mensaje|código|ping_ms" (fase: idle, waiting, connecting, syncing, playing). */
std::string netStatus();
/** Mando web del Jugador 2: abre una sala en el relay; las pulsaciones llegan al puerto 1. */
bool webPadStart(const char *relayHost, int relayPort);
void webPadStop();
/** "fase|código|mensaje|asientos" (asientos: bit p = puerto p con mando web conectado). */
std::string webPadStatus();
/** Expulsa al mando web del puerto 1-3. */
void webPadKick(int port);
/** Puertos (bits) ocupados por mandos físicos: el relay no los asigna a mandos web. */
void webPadReserve(int mask);
/** IPv4 de la Wi-Fi (o de la primera interfaz activa). */
std::string localAddress();
/** Ruta del juego que se va a cargar (arcade: su carpeta hace de system directory). Antes de loadCore. */
void setContentPath(const char *romPath);
/** Ritmo nativo del núcleo y ritmo medido del bucle de emulación (frames por segundo). */
double targetFps();
double measuredFps();
void reset();

/** Avance rápido: 1 = normal, 2-8 = frames extra por periodo (sin audio en los extra). */
void setSpeed(int speed);
int speed();
/** Función llamada en el hilo de emulación, con el núcleo bloqueado, tras cada retro_run. */
void setFrameHook(void (*hook)());
/** Memoria del núcleo (RETRO_MEMORY_*) del juego cargado; solo desde el gancho por frame. */
uint8_t *memoryData(unsigned id);
size_t memorySize(unsigned id);
/** Mapa de memoria declarado por el núcleo (nullptr si no declaró ninguno). */
const struct retro_memory_map *memoryMap();
/** Discos del juego: JSON {count, index, labels}. count 0 = el núcleo no permite cambiarlos. */
std::string diskInfo();
/** Cambia al disco index (abre la bandeja, cambia y la cierra). */
bool diskSet(int index);

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
