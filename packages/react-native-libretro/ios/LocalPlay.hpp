// Multijugador en red local (Wi-Fi / QR): el iPhone anfitrión sirve una página para cada jugador.
//   GET /                  página del mando (elegir ranura, Solo palanca / Pantalla + palanca)
//   GET /ws                WebSocket: "hello:N" elige ranura (N = 2..4), "stream:0|1" activa el video,
//                          binario [botones lo, hi, lx, ly, rx, ry] = mando en tiempo real
//   GET /stream.mjpeg?p=N  video MJPEG del juego (solo si la ranura N tiene el video activado)
// P1 es el propio iPhone anfitrión; los teléfonos entran como P2, P3 y P4.
#pragma once

#include <cstdint>
#include <string>

namespace localplay {

/** Arranca el servidor en el puerto dado. false si no pudo escuchar. */
bool start(uint16_t port);
/** Para el servidor y libera las ranuras. */
void stop();
bool running();
/** JSON {"seats":[{"slot":2,"connected":false,"stream":false}, ...]} */
std::string statusJson();

}  // namespace localplay
