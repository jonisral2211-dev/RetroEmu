#include "LibretroHost.hpp"

#include <arpa/inet.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>
#include <zlib.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <atomic>
#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "AudioOutput.hpp"
#include "libretro.h"

namespace host {
namespace {

// Punteros a la API de Libretro resueltos con dlsym.
struct CoreApi {
  void *handle = nullptr;
  void (*init)() = nullptr;
  void (*deinit)() = nullptr;
  void (*setEnvironment)(retro_environment_t) = nullptr;
  void (*setVideoRefresh)(retro_video_refresh_t) = nullptr;
  void (*setAudioSampleBatch)(retro_audio_sample_batch_t) = nullptr;
  void (*setAudioSample)(retro_audio_sample_t) = nullptr;  // opcional en la práctica, pero se registra
  void (*setInputPoll)(retro_input_poll_t) = nullptr;
  void (*setInputState)(retro_input_state_t) = nullptr;
  void (*setControllerPortDevice)(unsigned, unsigned) = nullptr;
  void (*getSystemInfo)(retro_system_info *) = nullptr;
  void (*getSystemAvInfo)(retro_system_av_info *) = nullptr;
  bool (*loadGame)(const retro_game_info *) = nullptr;
  void (*unloadGame)() = nullptr;
  void (*run)() = nullptr;
  void (*reset)() = nullptr;
  size_t (*serializeSize)() = nullptr;
  bool (*serialize)(void *, size_t) = nullptr;
  bool (*unserialize)(const void *, size_t) = nullptr;
  void *(*getMemoryData)(unsigned) = nullptr;
  size_t (*getMemorySize)(unsigned) = nullptr;

  bool complete() const {
    return init && deinit && setEnvironment && setVideoRefresh && setAudioSampleBatch &&
           setInputPoll && setInputState && setControllerPortDevice && getSystemInfo &&
           getSystemAvInfo && loadGame && unloadGame && run && reset && serializeSize &&
           serialize && unserialize && getMemoryData && getMemorySize;
  }
};

CoreApi g_core;
bool g_gameLoaded = false;
std::mutex g_coreMutex;  // serializa retro_run() frente a save/load/reset/unload
std::thread g_thread;
std::atomic<bool> g_running{false};
std::atomic<bool> g_paused{false};
std::atomic<uint16_t> g_buttons{0};
std::atomic<int16_t> g_axisX{0};  // stick izquierdo (RETRO_DEVICE_ANALOG)
std::atomic<int16_t> g_axisY{0};
// Estado del mando físico (escrito desde GameController, leído en input_state)
std::atomic<uint16_t> g_padButtons{0};
std::atomic<int16_t> g_padX{0};
std::atomic<int16_t> g_padY{0};
// Stick derecho y gatillos analógicos L2/R2 del mando (0..0x7fff)
std::atomic<int16_t> g_padRX{0};
std::atomic<int16_t> g_padRY{0};
std::atomic<int16_t> g_padL2{0};
std::atomic<int16_t> g_padR2{0};
// Segundo mando físico (Jugador 2, puerto 1)
std::atomic<uint16_t> g_pad2Buttons{0};
std::atomic<int16_t> g_pad2X{0};
std::atomic<int16_t> g_pad2Y{0};
std::atomic<int16_t> g_pad2RX{0};
std::atomic<int16_t> g_pad2RY{0};
std::atomic<int16_t> g_pad2L2{0};
std::atomic<int16_t> g_pad2R2{0};
// Vibración: intensidad pedida por el core (0..0xffff) por puerto, motor fuerte y débil
std::atomic<uint16_t> g_rumbleStrong[2] = {{0}, {0}};
std::atomic<uint16_t> g_rumbleWeak[2] = {{0}, {0}};
void (*g_rumbleHandler)(unsigned port, float strong, float weak) = nullptr;
// Ruta de la ROM cargada y núcleo (para el saludo de netplay)
std::string g_romPath;
std::string g_coreFile;

// ---- Netplay (rollback + retardo de entrada adaptable) -----------------------------------
// Cada iPhone ejecuta el mismo núcleo con el mismo juego y la misma partida inicial (el anfitrión
// envía su save state). Cada frame se envía la entrada local para el frame f + retardo. Con
// rollback, si la entrada del otro jugador aún no ha llegado se predice (se repite la última) y
// el juego sigue; cuando llega y no coincide, se vuelve al estado guardado de ese frame y se
// re-emulan en silencio los frames hasta el actual. Sin rollback (núcleos con estados enormes:
// N64, PSP) se espera la entrada con un retardo que se ajusta al ping.
// Conexión directa (IP/LAN) o por un servidor relay con código de sala de 6 caracteres.
struct NetInput {
  uint16_t buttons;
  int16_t lx, ly, rx, ry;
};
constexpr uint32_t kNetMagic = 0x504E4C4A;  // "JLNP"
constexpr uint32_t kNetProto = 2;
constexpr int kNetTimeoutMs = 20000;
constexpr uint32_t kNetRing = 32;
constexpr uint32_t kNetStart = 2;  // frames 0 y 1: entrada vacía en ambos lados
struct NetHello {
  uint32_t magic;
  uint32_t proto;
  uint64_t romSize;
  uint32_t romCrc;
  char core[48];
  char rom[160];
};
struct NetReply {
  uint32_t ok;
  char message[200];
};
struct NetMsg {
  uint32_t frame;
  NetInput in;
  uint16_t reserved;
  uint32_t sentMs;  // reloj del emisor
  uint32_t echoMs;  // sentMs del último mensaje recibido + tiempo retenido (para el ping)
};
std::mutex g_netMutex;           // protege g_netStatus, g_netCode y g_netBlob
std::string g_netStatus = "idle|Sin conexión";
std::string g_netCode;           // código de sala (relay)
std::vector<uint8_t> g_netBlob;  // cliente: save state recibido del anfitrión
std::atomic<int> g_netRole{0};   // 0 = nada, 1 = anfitrión (jugador 1), 2 = cliente (jugador 2)
std::atomic<int> g_netFd{-1};
std::atomic<int> g_netListenFd{-1};
std::atomic<bool> g_netPending{false};  // conexión aceptada; falta sincronizar en el hilo de emulación
std::atomic<bool> g_netActive{false};
std::atomic<int> g_netPingMs{-1};
std::atomic<bool> g_replaying{false};  // re-emulación de rollback: sin vídeo, audio ni vibración
// Sesión (solo hilo de emulación)
struct NetSession {
  uint32_t frame = 0;        // siguiente frame a emular
  uint32_t remoteKnown = 0;  // frames < remoteKnown con entrada remota confirmada
  uint32_t lastSent = 0;     // último frame local enviado
  uint32_t delay = 2;        // retardo de entrada local (frames)
  uint32_t window = 0;       // frames máximos de predicción (0 = sin rollback)
  NetInput local[kNetRing]{};
  NetInput remote[kNetRing]{};
  NetInput used[kNetRing]{};  // entrada remota usada en cada frame (real o predicha)
  std::vector<uint8_t> states[kNetRing];
  std::vector<uint8_t> rx;  // bytes recibidos aún sin procesar
  uint32_t echoBase = 0;    // sentMs del último mensaje del otro
  uint32_t echoAt = 0;      // cuándo llegó (reloj local)
  double ping = -1;
  uint32_t rollbacks = 0;
};
NetSession g_ns;
NetInput g_netCur[2];
// Puntero táctil (stylus de NDS): coordenadas Libretro [-0x7fff, 0x7fff] sobre el frame completo
std::atomic<int16_t> g_pointerX{0};
std::atomic<int16_t> g_pointerY{0};
std::atomic<bool> g_pointerDown{false};
// Diagnóstico: qué lee realmente el core (se vacía en cada debugState())
std::atomic<uint32_t> g_dbgJoyHits{0};  // bit id = el core pidió ese botón y recibió 1
std::atomic<int16_t> g_dbgAxisX{0};     // último valor devuelto para el stick (X/Y)
std::atomic<int16_t> g_dbgAxisY{0};
std::atomic<uint32_t> g_dbgReads{0};    // lecturas de input_state desde la última instantánea
std::atomic<uint32_t> g_dbgUiHits{0};   // botones escritos desde la UI desde la última instantánea
std::atomic<uint32_t> g_dbgFrameW{0};   // último frame recibido del core
std::atomic<uint32_t> g_dbgFrameH{0};
std::atomic<uint32_t> g_dbgFramePitch{0};
std::atomic<uint32_t> g_dbgFrameBpp{4};
// Color medio (0xRRGGBB) de las columnas 0, 1 y central del último frame del core: si la
// columna 0 sale blanca aquí, la línea viene del propio juego/core, no del render Metal
std::atomic<uint32_t> g_dbgCol0{0};
std::atomic<uint32_t> g_dbgCol1{0};
std::atomic<uint32_t> g_dbgColMid{0};
bool g_isN64 = false;
// Relación de aspecto de pantalla que declara el core (no la del buffer: PS1 usa píxeles no
// cuadrados). 0 = desconocida (se usa ancho/alto del frame).
std::atomic<float> g_aspect{0.0f};
FrameBuffer g_frame;
AudioOutput g_audio;
// Callback de estado del búfer de audio que registra el core (frameskip automático)
retro_audio_buffer_status_callback_t g_audioStatus = nullptr;

enum retro_pixel_format g_pixelFormat = RETRO_PIXEL_FORMAT_0RGB1555;
double g_sampleRate = 32768.0;
double g_fps = 60.0;
std::string g_systemDir;
std::string g_saveDir;
std::string g_stateDir;  // Documents/states (save states); antes iban en saves/
std::string g_romBase;
std::vector<uint8_t> g_romData;
std::string g_lastError;  // motivo del último fallo de loadCore/loadGame
// Avisos del núcleo (warn/error) de la última carga: explican por qué retro_load_game falla
std::string g_coreLog;

void coreLog(enum retro_log_level level, const char *fmt, ...) {
  char buf[512];
  va_list args;
  va_start(args, fmt);
  std::vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  std::fprintf(stderr, "[core %d] %s", static_cast<int>(level), buf);
  // RETRO_LOG_ERROR (3) > RETRO_LOG_WARN (2): se guardan avisos y errores del core
  if (level >= RETRO_LOG_WARN && g_coreLog.size() < 1024) {
    g_coreLog += buf;
  }
}

// Opciones elegidas por el usuario en la app (p. ej. resolución interna de PS1). Tienen
// prioridad sobre las forzadas. Al cambiar, el core las relee (GET_VARIABLE_UPDATE).
std::mutex g_optionsMutex;
std::map<std::string, std::string> g_userOptions;
std::atomic<bool> g_optionsDirty{false};

const char *userOption(const char *key) {
  std::lock_guard<std::mutex> lock(g_optionsMutex);
  auto it = g_userOptions.find(key);
  return it == g_userOptions.end() ? nullptr : it->second.c_str();  // estable hasta el próximo set
}

// Opciones de core forzadas por el frontend: nitidez estable por software sin perder 60 FPS.
// Claves y valores verificados en libretro_core_options.h de cada core (upstream master).
const char *forcedOption(const char *key) {
  struct Opt {
    const char *key;
    const char *value;
  };
  static const Opt kOptions[] = {
      // PCSX ReARMed (GPU NEON): 1x nativo por defecto (el 2x por CPU satura el procesador,
      // corta el audio y deja costuras/rayas en algunos juegos). El usuario puede elegir 2x HD
      // desde la app (userOption). Sin tramado: imagen limpia.
      {"pcsx_rearmed_neon_enhancement_enable", "disabled"},
      {"pcsx_rearmed_neon_enhancement_no_main", "enabled"},
      {"pcsx_rearmed_neon_enhancement_tex_adj_v2", "enabled"},
      {"pcsx_rearmed_dithering", "disabled"},
      // 60 FPS estables en juegos 3D pesados (Dragon Ball GT Final Bout, Army Men Air Attack):
      // salto de frames automático guiado por el llenado del audio (el sonido nunca se corta,
      // como mucho se omite algún frame de vídeo), GPU en su propio hilo e interpolación de
      // SPU simple (la gaussiana/cúbica cuesta CPU y apenas se nota en el altavoz del iPhone)
      {"pcsx_rearmed_frameskip_type", "auto"},
      {"pcsx_rearmed_gpu_thread_rendering", "enabled"},
      {"pcsx_rearmed_spu_interpolation", "simple"},
      // Genesis Plus GX: oculta la columna de 8 px que el VDP de Master System deja con basura
      // en el borde izquierdo (franja vertical), sin filtros NTSC/LCD que emborronan
      {"genesis_plus_gx_left_border", "left border"},
      {"genesis_plus_gx_blargg_ntsc_filter", "disabled"},
      {"genesis_plus_gx_lcd_filter", "disabled"},
      // Mupen64Plus (angrylion, RDP por software): antialiasing sin tramado, todos los hilos
      {"mupen64plus-angrylion-vioverlay", "AA+Dedither"},
      {"mupen64plus-angrylion-multithread", "all threads"},
      // melonDS: sin JIT (prohibido en iOS), render por software en hilo propio, pantalla táctil
      // por RETRO_DEVICE_POINTER, arranque directo al juego (FreeBIOS si no hay BIOS)
      {"melonds_jit_enable", "disabled"},
      {"melonds_opengl_renderer", "disabled"},
      {"melonds_threaded_renderer", "enabled"},
      {"melonds_touch_mode", "Touch"},
      {"melonds_boot_directly", "enabled"},
      {"melonds_console_mode", "DS"},
      {"melonds_screen_layout", "Top/Bottom"},
      {"melonds_screen_gap", "0"},
      // DeSmuME (respaldo de NDS): intérprete, software, puntero táctil
      {"desmume_cpu_mode", "interpreter"},
      {"desmume_opengl_mode", "disabled"},
      {"desmume_pointer_type", "touch"},
      {"desmume_internal_resolution", "256x192"},
      {"desmume_screens_layout", "top/bottom"},
      {"desmume_screens_gap", "0"},
      // PPSSPP (PSP): sin JIT en iOS -> intérprete IR; render por software (el host no ofrece
      // contexto GL); resolución nativa, salto de frames automático y E/S rápida
      {"ppsspp_cpu_core", "IR JIT"},
      {"ppsspp_fast_memory", "enabled"},
      {"ppsspp_internal_resolution", "480x272"},
      {"ppsspp_auto_frameskip", "enabled"},
      // Salto de frames automático de 1 cuadro como máximo (fluido sin tirones visibles); el
      // host ya limita a 60 FPS (ritmo del núcleo) y no hay lecturas de GPU que esperar
      {"ppsspp_frameskip", "1"},
      {"ppsspp_frameskiptype", "Number of frames"},
      {"ppsspp_skip_gpu_readbacks", "enabled"},
      {"ppsspp_texture_deposterize", "disabled"},
      {"ppsspp_io_timing_method", "Fast"},
      {"ppsspp_software_rendering", "enabled"},
      {"ppsspp_texture_scaling_level", "disabled"},
      {"ppsspp_inflight_frames", "No buffer"},
      // Yabause (Saturn): render por software multihilo y salto de frames automático
      {"yabause_frameskip", "enabled"},
      {"yabause_numthreads", "4"},
  };
  for (const Opt &o : kOptions) {
    if (std::strcmp(key, o.key) == 0) return o.value;
  }
  return nullptr;
}

void updateAspect(const retro_game_geometry &g) {
  float a = g.aspect_ratio;
  if (!(a > 0.0f) && g.base_width && g.base_height) a = float(g.base_width) / float(g.base_height);
  g_aspect.store(a > 0.0f ? a : 0.0f, std::memory_order_relaxed);
}

// ---- Callbacks de Libretro (la API es C: deben tener enlace C) -------------
extern "C" {

// BIOS de PlayStation real presente en system/. Sin él, PCSX ReARMed usa su BIOS HLE.
bool hasPs1Bios() {
  static const char *const kBios[] = {"scph5501.bin", "scph1001.bin", "scph7001.bin", "scph5500.bin"};
  for (const char *name : kBios) {
    struct stat st {};
    if (stat((g_systemDir + "/" + name).c_str(), &st) == 0) return true;
  }
  return false;
}

static bool onRumble(unsigned port, enum retro_rumble_effect effect, uint16_t strength) {
  if (port > 1 || g_replaying.load(std::memory_order_relaxed)) return true;
  auto &slot = effect == RETRO_RUMBLE_STRONG ? g_rumbleStrong[port] : g_rumbleWeak[port];
  if (slot.exchange(strength) == strength) return true;  // sin cambios: no molestar al mando
  if (g_rumbleHandler) {
    g_rumbleHandler(port, g_rumbleStrong[port].load() / 65535.0f, g_rumbleWeak[port].load() / 65535.0f);
  }
  return true;
}

// Jugador 2 en local: solo el segundo mando físico
static int16_t port2InputState(unsigned device, unsigned index, unsigned id) {
  if (device == RETRO_DEVICE_ANALOG && index == RETRO_DEVICE_INDEX_ANALOG_LEFT) {
    return id == RETRO_DEVICE_ID_ANALOG_X ? g_pad2X.load() : id == RETRO_DEVICE_ID_ANALOG_Y ? g_pad2Y.load() : 0;
  }
  if (device == RETRO_DEVICE_ANALOG && index == RETRO_DEVICE_INDEX_ANALOG_RIGHT) {
    return id == RETRO_DEVICE_ID_ANALOG_X ? g_pad2RX.load() : id == RETRO_DEVICE_ID_ANALOG_Y ? g_pad2RY.load() : 0;
  }
  if (device == RETRO_DEVICE_ANALOG && index == RETRO_DEVICE_INDEX_ANALOG_BUTTON && id < 16) {
    if (id == RETRO_DEVICE_ID_JOYPAD_L2 && g_pad2L2.load()) return g_pad2L2.load();
    if (id == RETRO_DEVICE_ID_JOYPAD_R2 && g_pad2R2.load()) return g_pad2R2.load();
    return ((g_pad2Buttons.load() >> id) & 1) ? 0x7fff : 0;
  }
  if (device != RETRO_DEVICE_JOYPAD || index != 0 || id > 15) return 0;
  return static_cast<int16_t>((g_pad2Buttons.load() >> id) & 1);
}

static bool onEnvironment(unsigned cmd, void *data) {
  switch (cmd) {
    case RETRO_ENVIRONMENT_GET_CAN_DUPE:
      *static_cast<bool *>(data) = true;
      return true;
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: {
      const auto fmt = *static_cast<const enum retro_pixel_format *>(data);
      if (fmt != RETRO_PIXEL_FORMAT_0RGB1555 && fmt != RETRO_PIXEL_FORMAT_XRGB8888 &&
          fmt != RETRO_PIXEL_FORMAT_RGB565)
        return false;
      g_pixelFormat = fmt;
      return true;
    }
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
      *static_cast<const char **>(data) = g_systemDir.c_str();
      return true;
    case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
      *static_cast<const char **>(data) = g_saveDir.c_str();
      return true;
    case RETRO_ENVIRONMENT_SET_VARIABLES:
    case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
    case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
      return true;
    case RETRO_ENVIRONMENT_SET_GEOMETRY:
      if (data) updateAspect(*static_cast<const struct retro_game_geometry *>(data));
      return true;
    case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO:
      if (data) updateAspect(static_cast<const struct retro_system_av_info *>(data)->geometry);
      return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE: {
      auto *var = static_cast<struct retro_variable *>(data);
      if (var && var->key) {
        if (const char *chosen = userOption(var->key)) {
          var->value = chosen;
          return true;
        }
        if (const char *forced = forcedOption(var->key)) {
          var->value = forced;
          return true;
        }
      }
      // N64 en iOS: RDP por software (sin contexto GL) e intérprete puro (sin JIT, prohibido en iOS)
      if (var && var->key && std::strcmp(var->key, "pcsx_rearmed_bios") == 0 && !hasPs1Bios()) {
        var->value = "HLE";  // PCSX ReARMed: BIOS HLE si no hay BIOS real
        return true;
      }
      if (g_isN64 && var && var->key) {
        // Claves reales del core: CORE_NAME = "mupen64plus" (ver mupen64plus-next_common.h)
        if (std::strcmp(var->key, "mupen64plus-rdp-plugin") == 0) {
          var->value = "angrylion";
          return true;
        }
        // Sin estas dos opciones mupen deja astick_sensitivity = 0 y el radio del stick es siempre 0
        // (ver emulate_game_controller_via_libretro.c): el stick nunca mueve a Mario.
        // Valores por defecto del propio core (libretro_core_options.h).
        if (std::strcmp(var->key, "mupen64plus-astick-sensitivity") == 0) {
          var->value = "100";
          return true;
        }
        if (std::strcmp(var->key, "mupen64plus-astick-deadzone") == 0) {
          var->value = "15";
          return true;
        }
        if (std::strcmp(var->key, "mupen64plus-cpucore") == 0) {
          var->value = "pure_interpreter";
          return true;
        }
      }
      return false;  // el resto de opciones: valores por defecto del core
    }
    case RETRO_ENVIRONMENT_SET_AUDIO_BUFFER_STATUS_CALLBACK: {
      // Frameskip automático (PCSX, Yabause, FBNeo…): cada frame se informa del llenado del audio
      const auto *cb = static_cast<const struct retro_audio_buffer_status_callback *>(data);
      g_audioStatus = cb ? cb->callback : nullptr;
      return true;
    }
    case RETRO_ENVIRONMENT_GET_RUMBLE_INTERFACE:
      static_cast<struct retro_rumble_interface *>(data)->set_rumble_state = onRumble;
      return true;
    case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
      static_cast<struct retro_log_callback *>(data)->log = coreLog;
      return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
      *static_cast<bool *>(data) = g_optionsDirty.exchange(false);
      return true;
    case RETRO_ENVIRONMENT_SHUTDOWN:
      g_running = false;
      return true;
    default:
      return false;
  }
}

size_t bytesPerPixel(enum retro_pixel_format fmt) {
  return fmt == RETRO_PIXEL_FORMAT_XRGB8888 ? 4 : 2;
}

static void onVideo(const void *data, unsigned width, unsigned height, size_t pitch) {
  if (g_replaying.load(std::memory_order_relaxed)) return;
  if (!data || !width || !height) return;  // NULL = frame duplicado, nada nuevo
  const auto fmt = g_pixelFormat;
  const size_t bpp = bytesPerPixel(fmt);
  // El pitch del core (bytes por fila en origen) puede ser mayor que width*bpp (relleno).
  // Si fuese menor, leer `width` píxeles invadiría la fila siguiente y el contenido aparecería
  // desplazado en franja: se recorta el ancho a lo que cabe realmente en una fila.
  if (pitch < size_t(width) * bpp) width = static_cast<unsigned>(pitch / bpp);
  if (!width) return;
  // Diagnóstico de tamaño/pitch por frame
  g_dbgFrameW.store(width, std::memory_order_relaxed);
  g_dbgFrameH.store(height, std::memory_order_relaxed);
  g_dbgFramePitch.store(static_cast<uint32_t>(pitch), std::memory_order_relaxed);
  g_dbgFrameBpp.store(static_cast<uint32_t>(bpp), std::memory_order_relaxed);
  const auto *src = static_cast<const uint8_t *>(data);

  // Copia fila a fila: origen con el pitch real del core (src + y * pitch, puede llevar
  // relleno), destino compacto BGRA8 (width * 4). Metal recibe solo el búfer compacto.
  g_frame.write(width, height, [&](uint8_t *dst, size_t dstStride) {
    for (unsigned y = 0; y < height; ++y) {
      const uint8_t *row = src + size_t(y) * pitch;  // origen: pitch del core
      uint8_t *out = dst + size_t(y) * dstStride;    // destino: BGRA8 empaquetado
      if (fmt == RETRO_PIXEL_FORMAT_XRGB8888) {
        // En memoria little-endian: B G R X => ya es BGRA
        for (unsigned x = 0; x < width; ++x) {
          out[x * 4 + 0] = row[x * 4 + 0];
          out[x * 4 + 1] = row[x * 4 + 1];
          out[x * 4 + 2] = row[x * 4 + 2];
          out[x * 4 + 3] = 255;
        }
      } else {
        const auto *px = reinterpret_cast<const uint16_t *>(row);
        for (unsigned x = 0; x < width; ++x) {
          const uint16_t v = px[x];
          uint8_t r, g, b;
          if (fmt == RETRO_PIXEL_FORMAT_RGB565) {
            r = (v >> 11) & 31;
            g = (v >> 5) & 63;
            b = v & 31;
            r = uint8_t((r << 3) | (r >> 2));
            g = uint8_t((g << 2) | (g >> 4));
            b = uint8_t((b << 3) | (b >> 2));
          } else {  // 0RGB1555
            r = (v >> 10) & 31;
            g = (v >> 5) & 31;
            b = v & 31;
            r = uint8_t((r << 3) | (r >> 2));
            g = uint8_t((g << 3) | (g >> 2));
            b = uint8_t((b << 3) | (b >> 2));
          }
          out[x * 4 + 0] = b;
          out[x * 4 + 1] = g;
          out[x * 4 + 2] = r;
          out[x * 4 + 3] = 255;
        }
      }
    }
    // Diagnóstico: color medio de las columnas 0, 1 y central (ya convertidas a BGRA)
    auto column = [&](unsigned x) -> uint32_t {
      uint64_t sr = 0, sg = 0, sb = 0;
      for (unsigned y = 0; y < height; ++y) {
        const uint8_t *px = dst + size_t(y) * dstStride + size_t(x) * 4;
        sb += px[0];
        sg += px[1];
        sr += px[2];
      }
      return uint32_t(((sr / height) << 16) | ((sg / height) << 8) | (sb / height));
    };
    g_dbgCol0.store(column(0), std::memory_order_relaxed);
    g_dbgCol1.store(column(width > 1 ? 1 : 0), std::memory_order_relaxed);
    g_dbgColMid.store(column(width / 2), std::memory_order_relaxed);
  });
}

static size_t onAudioBatch(const int16_t *data, size_t frames) {
  if (g_replaying.load(std::memory_order_relaxed)) return frames;
  g_audio.push(data, frames, g_sampleRate);
  return frames;
}

// Cores que envían el audio muestra a muestra: se agrupan en bloques para el remuestreador
static std::vector<int16_t> g_sampleBuf;
static void onAudioSample(int16_t left, int16_t right) {
  if (g_replaying.load(std::memory_order_relaxed)) return;
  g_sampleBuf.push_back(left);
  g_sampleBuf.push_back(right);
  if (g_sampleBuf.size() >= 512 * 2) {
    g_audio.push(g_sampleBuf.data(), g_sampleBuf.size() / 2, g_sampleRate);
    g_sampleBuf.clear();
  }
}

static void onInputPoll(void) {}

static int16_t netInputState(unsigned port, unsigned device, unsigned index, unsigned id) {
  if (port > 1) return 0;
  const NetInput &in = g_netCur[port];
  if (device == RETRO_DEVICE_ANALOG && index == RETRO_DEVICE_INDEX_ANALOG_LEFT) {
    return id == RETRO_DEVICE_ID_ANALOG_X ? in.lx : id == RETRO_DEVICE_ID_ANALOG_Y ? in.ly : 0;
  }
  if (device == RETRO_DEVICE_ANALOG && index == RETRO_DEVICE_INDEX_ANALOG_RIGHT) {
    return id == RETRO_DEVICE_ID_ANALOG_X ? in.rx : id == RETRO_DEVICE_ID_ANALOG_Y ? in.ry : 0;
  }
  if (device == RETRO_DEVICE_ANALOG && index == RETRO_DEVICE_INDEX_ANALOG_BUTTON && id < 16) {
    return ((in.buttons >> id) & 1) ? 0x7fff : 0;
  }
  if (device != RETRO_DEVICE_JOYPAD || index != 0 || id > 15) return 0;
  return static_cast<int16_t>((in.buttons >> id) & 1);
}

static int16_t onInputState(unsigned port, unsigned device, unsigned index, unsigned id) {
  g_dbgReads.fetch_add(1, std::memory_order_relaxed);
  if (g_netActive.load(std::memory_order_relaxed)) return netInputState(port, device, index, id);
  if (port == 1) return port2InputState(device, index, id);
  if (port != 0) return 0;
  if (device == RETRO_DEVICE_ANALOG && index == RETRO_DEVICE_INDEX_ANALOG_RIGHT) {
    if (id == RETRO_DEVICE_ID_ANALOG_X) return g_padRX.load();
    if (id == RETRO_DEVICE_ID_ANALOG_Y) return g_padRY.load();
    return 0;
  }
  if (device == RETRO_DEVICE_ANALOG && index == RETRO_DEVICE_INDEX_ANALOG_BUTTON && id < 16) {
    // Gatillos analógicos del mando (PS2-style); el resto de botones, todo o nada
    if (id == RETRO_DEVICE_ID_JOYPAD_L2 && g_padL2.load()) return g_padL2.load();
    if (id == RETRO_DEVICE_ID_JOYPAD_R2 && g_padR2.load()) return g_padR2.load();
    return (((g_buttons.load() | g_padButtons.load()) >> id) & 1) ? 0x7fff : 0;
  }
  if (device == RETRO_DEVICE_POINTER && index == 0) {
    switch (id) {
      case RETRO_DEVICE_ID_POINTER_X: return g_pointerX.load();
      case RETRO_DEVICE_ID_POINTER_Y: return g_pointerY.load();
      case RETRO_DEVICE_ID_POINTER_PRESSED: return g_pointerDown.load() ? 1 : 0;
      case RETRO_DEVICE_ID_POINTER_COUNT: return g_pointerDown.load() ? 1 : 0;
      default: return 0;
    }
  }
  if (device == RETRO_DEVICE_ANALOG && index == RETRO_DEVICE_INDEX_ANALOG_LEFT) {
    // El stick del mando tiene prioridad sobre el táctil cuando está en uso
    const int16_t padX = g_padX.load(), padY = g_padY.load();
    const bool usePad = padX != 0 || padY != 0;
    int16_t value = 0;
    if (id == RETRO_DEVICE_ID_ANALOG_X) value = usePad ? padX : g_axisX.load();
    if (id == RETRO_DEVICE_ID_ANALOG_Y) value = usePad ? padY : g_axisY.load();
    if (id == RETRO_DEVICE_ID_ANALOG_X) g_dbgAxisX.store(value, std::memory_order_relaxed);
    if (id == RETRO_DEVICE_ID_ANALOG_Y) g_dbgAxisY.store(value, std::memory_order_relaxed);
    return value;
  }
  if (device != RETRO_DEVICE_JOYPAD || index != 0 || id > 15) return 0;
  const int16_t pressed = static_cast<int16_t>(((g_buttons.load() | g_padButtons.load()) >> id) & 1);
  if (pressed) g_dbgJoyHits.fetch_or(1u << id, std::memory_order_relaxed);
  return pressed;
}

}  // extern "C"

// ---- Utilidades (llamar con g_coreMutex tomado cuando toque el core) ------

std::string sramPath() { return g_saveDir + "/" + g_romBase + ".srm"; }
std::string statePath(int slot) {
  return g_stateDir + "/" + g_romBase + ".state" + std::to_string(slot);
}
// Ubicación anterior (saves/): se sigue leyendo para no perder estados ya guardados
std::string legacyStatePath(int slot) {
  return g_saveDir + "/" + g_romBase + ".state" + std::to_string(slot);
}

bool readFile(const std::string &path, std::vector<uint8_t> &out) {
  std::ifstream f(path, std::ios::binary | std::ios::ate);
  if (!f) return false;
  const std::streamsize size = f.tellg();
  f.seekg(0);
  out.resize(size_t(size));
  f.read(reinterpret_cast<char *>(out.data()), size);
  return bool(f);
}

void restoreSram() {
  const size_t size = g_core.getMemorySize(RETRO_MEMORY_SAVE_RAM);
  void *data = g_core.getMemoryData(RETRO_MEMORY_SAVE_RAM);
  if (!size || !data) return;
  std::vector<uint8_t> buf;
  if (!readFile(sramPath(), buf)) return;
  std::memcpy(data, buf.data(), std::min(size, buf.size()));
}

void persistSram() {
  std::lock_guard<std::mutex> lock(g_coreMutex);
  if (!g_gameLoaded) return;
  const size_t size = g_core.getMemorySize(RETRO_MEMORY_SAVE_RAM);
  void *data = g_core.getMemoryData(RETRO_MEMORY_SAVE_RAM);
  if (!size || !data) return;
  std::ofstream f(sramPath(), std::ios::binary);
  f.write(static_cast<const char *>(data), std::streamsize(size));
}

void unloadGameLocked() {
  if (g_gameLoaded) {
    g_core.unloadGame();
    g_gameLoaded = false;
  }
  g_romData.clear();
  g_romData.shrink_to_fit();
  g_aspect.store(0.0f, std::memory_order_relaxed);
}

// ---- Netplay ----------------------------------------------------------------------------------

uint32_t nowMs() {
  using namespace std::chrono;
  return uint32_t(duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count());
}

void netSetStatus(const std::string &state, const std::string &message) {
  std::lock_guard<std::mutex> lock(g_netMutex);
  g_netStatus = state + "|" + message;
}

// Envía todo; con el socket sin bloqueo (partida en curso) espera a que haya hueco en vez de
// cortar un mensaje a medias (eso corrompería el flujo y desincronizaría a los jugadores)
bool sendAll(int fd, const void *data, size_t size) {
  const auto *p = static_cast<const uint8_t *>(data);
  while (size > 0) {
    const ssize_t n = ::send(fd, p, size, 0);
    if (n > 0) {
      p += n;
      size -= size_t(n);
      continue;
    }
    if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR)) {
      pollfd pfd{fd, POLLOUT, 0};
      if (::poll(&pfd, 1, kNetTimeoutMs) <= 0) return false;
      continue;
    }
    return false;
  }
  return true;
}

bool recvAll(int fd, void *data, size_t size, int timeoutMs) {
  auto *p = static_cast<uint8_t *>(data);
  while (size > 0) {
    pollfd pfd{fd, POLLIN, 0};
    if (::poll(&pfd, 1, timeoutMs) <= 0) return false;
    const ssize_t n = ::recv(fd, p, size, 0);
    if (n <= 0) return false;
    p += n;
    size -= size_t(n);
  }
  return true;
}

// Línea de texto del relay (termina en \n), byte a byte para no comerse datos del juego
bool recvLine(int fd, std::string &line, int timeoutMs) {
  line.clear();
  char c = 0;
  while (line.size() < 256) {
    if (!recvAll(fd, &c, 1, timeoutMs)) return false;
    if (c == '\n') return true;
    if (c != '\r') line += c;
  }
  return false;
}

void closeFd(std::atomic<int> &fd) {
  const int old = fd.exchange(-1);
  if (old >= 0) {
    ::shutdown(old, SHUT_RDWR);
    ::close(old);
  }
}

void tuneSocket(int fd) {
  int one = 1;
  ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
#ifdef SO_NOSIGPIPE
  ::setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
#endif
}

// Conexión TCP con tiempo límite (no bloquear 75 s si el destino no responde)
int connectTcp(const std::string &host, int port, int timeoutMs, std::string &error) {
  addrinfo hints{};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  addrinfo *res = nullptr;
  if (::getaddrinfo(host.c_str(), std::to_string(port).c_str(), &hints, &res) != 0 || !res) {
    error = "No se encuentra " + host + " (¿hay Internet?)";
    return -1;
  }
  int fd = -1;
  for (addrinfo *a = res; a && fd < 0; a = a->ai_next) {
    fd = ::socket(a->ai_family, a->ai_socktype, a->ai_protocol);
    if (fd < 0) continue;
    ::fcntl(fd, F_SETFL, ::fcntl(fd, F_GETFL) | O_NONBLOCK);
    if (::connect(fd, a->ai_addr, a->ai_addrlen) != 0) {
      pollfd pfd{fd, POLLOUT, 0};
      int err = 0;
      socklen_t len = sizeof err;
      if (::poll(&pfd, 1, timeoutMs) <= 0 || ::getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &len) != 0 || err != 0) {
        ::close(fd);
        fd = -1;
        continue;
      }
    }
    ::fcntl(fd, F_SETFL, ::fcntl(fd, F_GETFL) & ~O_NONBLOCK);
  }
  ::freeaddrinfo(res);
  if (fd < 0) {
    error = "No responde " + host + ":" + std::to_string(port);
    return -1;
  }
  tuneSocket(fd);
  return fd;
}

// Huella del juego: tamaño + CRC32 del primer 16 MB (rápido incluso con ISOs de 2 GB)
NetHello makeHello() {
  NetHello h{};
  h.magic = kNetMagic;
  h.proto = kNetProto;
  FILE *f = std::fopen(g_romPath.c_str(), "rb");
  if (f) {
    std::fseek(f, 0, SEEK_END);
    h.romSize = uint64_t(ftello(f));
    std::fseek(f, 0, SEEK_SET);
    std::vector<uint8_t> buf(1 << 20);
    uLong crc = crc32(0L, Z_NULL, 0);
    for (int i = 0; i < 16; ++i) {
      const size_t n = std::fread(buf.data(), 1, buf.size(), f);
      if (n == 0) break;
      crc = crc32(crc, buf.data(), uInt(n));
    }
    h.romCrc = uint32_t(crc);
    std::fclose(f);
  }
  std::snprintf(h.core, sizeof h.core, "%s", g_coreFile.c_str());
  const auto slash = g_romPath.find_last_of('/');
  std::snprintf(h.rom, sizeof h.rom, "%s", g_romPath.substr(slash == std::string::npos ? 0 : slash + 1).c_str());
  return h;
}

// Motivo de rechazo, o cadena vacía si los dos jugadores tienen lo mismo
std::string compareHello(const NetHello &mine, const NetHello &theirs) {
  if (theirs.magic != kNetMagic) return "No es JL Emulator";
  if (theirs.proto != kNetProto) return "Versión de JL Emulator distinta: actualizad los dos a la misma";
  if (std::strncmp(mine.core, theirs.core, sizeof mine.core) != 0) {
    return std::string("Núcleo distinto (") + theirs.core + " frente a " + mine.core + ")";
  }
  if (mine.romSize != theirs.romSize || mine.romCrc != theirs.romCrc) {
    return "Los archivos del juego no coinciden; ambos deben usar exactamente la misma ROM";
  }
  return "";
}

void netStopLocked(const std::string &message) {
  g_netActive = false;
  g_netPending = false;
  g_netRole = 0;
  g_netPingMs = -1;
  closeFd(g_netFd);
  closeFd(g_netListenFd);
  {
    std::lock_guard<std::mutex> lock(g_netMutex);
    g_netCode.clear();
  }
  netSetStatus("idle", message);
}

// Anfitrión: valida al jugador 2 y, si todo coincide, queda listo para sincronizar
bool hostHandshake(int fd, const NetHello &mine, std::string &why) {
  NetHello theirs{};
  if (!recvAll(fd, &theirs, sizeof theirs, 10000)) {
    why = "El Jugador 2 no respondió";
    return false;
  }
  why = compareHello(mine, theirs);
  NetReply reply{};
  reply.ok = why.empty() ? 1 : 0;
  std::snprintf(reply.message, sizeof reply.message, "%s", why.c_str());
  sendAll(fd, &reply, sizeof reply);
  if (!why.empty()) return false;
  g_netFd = fd;
  netSetStatus("syncing", "Jugador 2 conectado · sincronizando partida…");
  g_netPending = true;
  return true;
}

// Cliente: se presenta, espera el visto bueno y recibe la partida del anfitrión
void clientHandshake(int fd, const NetHello &mine) {
  NetReply reply{};
  uint64_t size = 0;
  if (!sendAll(fd, &mine, sizeof mine) || !recvAll(fd, &reply, sizeof reply, 15000)) {
    ::close(fd);
    netStopLocked("El anfitrión no respondió");
    return;
  }
  if (!reply.ok) {
    ::close(fd);
    reply.message[sizeof reply.message - 1] = 0;
    netStopLocked(reply.message);
    return;
  }
  netSetStatus("syncing", "Recibiendo la partida del anfitrión…");
  if (!recvAll(fd, &size, sizeof size, kNetTimeoutMs) || size == 0 || size > (512ull << 20)) {
    ::close(fd);
    netStopLocked("No llegó la partida del anfitrión");
    return;
  }
  std::vector<uint8_t> blob(size);
  if (!recvAll(fd, blob.data(), blob.size(), kNetTimeoutMs)) {
    ::close(fd);
    netStopLocked("Se cortó la conexión al recibir la partida");
    return;
  }
  {
    std::lock_guard<std::mutex> lock(g_netMutex);
    g_netBlob.swap(blob);
  }
  g_netFd = fd;
  g_netPending = true;
}

NetInput localInput() {
  NetInput in{};
  in.buttons = uint16_t(g_buttons.load() | g_padButtons.load());
  const int16_t px = g_padX.load(), py = g_padY.load();
  const bool pad = px != 0 || py != 0;
  in.lx = pad ? px : g_axisX.load();
  in.ly = pad ? py : g_axisY.load();
  in.rx = g_padRX.load();
  in.ry = g_padRY.load();
  return in;
}

bool sameInput(const NetInput &a, const NetInput &b) { return std::memcmp(&a, &b, sizeof a) == 0; }

std::string netPlayingMessage() {
  std::string m = g_netRole == 1 ? "Conectado · Jugador 1" : "Conectado · Jugador 2";
  m += g_ns.window ? " · rollback" : " · retardo " + std::to_string(g_ns.delay) + " frames";
  return m;
}

// Hilo de emulación, con g_coreMutex tomado: arranque de la sesión (estado inicial común)
void netBeginLocked() {
  g_netPending = false;
  const int fd = g_netFd.load();
  if (fd < 0) return;
  const size_t size = g_core.serializeSize();
  if (g_netRole == 1) {
    std::vector<uint8_t> state(size);
    const uint64_t size64 = size;
    if (!size || !g_core.serialize(state.data(), size) || !sendAll(fd, &size64, sizeof size64) ||
        !sendAll(fd, state.data(), size)) {
      netStopLocked("No se pudo enviar la partida al Jugador 2");
      return;
    }
  } else {
    std::vector<uint8_t> blob;
    {
      std::lock_guard<std::mutex> lock(g_netMutex);
      blob.swap(g_netBlob);
    }
    if (blob.empty() || !g_core.unserialize(blob.data(), blob.size())) {
      netStopLocked("No se pudo cargar la partida del anfitrión (¿mismo juego y núcleo?)");
      return;
    }
  }
  g_ns = NetSession();
  // Rollback si guardar el estado cada frame es barato (GBA, Mega Drive, arcade, PS1);
  // N64 y PSP (estados de 16-40 MB) usan retardo adaptable
  g_ns.window = size <= (2u << 20) ? 8 : size <= (8u << 20) ? 5 : 0;
  g_ns.delay = g_ns.window ? 1 : 3;
  g_ns.frame = 0;
  g_ns.remoteKnown = kNetStart;
  g_ns.lastSent = kNetStart - 1;
  std::memset(g_netCur, 0, sizeof g_netCur);
  // Socket sin bloqueo para leer lo que haya en cada frame
  ::fcntl(fd, F_SETFL, ::fcntl(fd, F_GETFL) | O_NONBLOCK);
  g_netActive = true;
  netSetStatus("playing", netPlayingMessage());
}

// Entradas de ambos jugadores para el frame k (la remota predicha si aún no ha llegado)
void netApplyInputs(uint32_t k) {
  NetInput loc{}, rem{};
  if (k >= kNetStart) {
    loc = g_ns.local[k % kNetRing];
    if (k < g_ns.remoteKnown) {
      rem = g_ns.remote[k % kNetRing];
    } else if (g_ns.remoteKnown > kNetStart) {
      rem = g_ns.remote[(g_ns.remoteKnown - 1) % kNetRing];  // predicción: repetir la última
    }
  }
  g_ns.used[k % kNetRing] = rem;
  g_netCur[0] = g_netRole == 1 ? loc : rem;
  g_netCur[1] = g_netRole == 1 ? rem : loc;
}

// Lee lo que haya llegado (esperando como mucho timeoutMs). Devuelve el primer frame ya emulado
// cuya predicción falló (o UINT32_MAX), y false en *lost si la conexión se cortó.
uint32_t netPump(int fd, int timeoutMs, bool *lost) {
  uint32_t rollbackFrom = UINT32_MAX;
  pollfd pfd{fd, POLLIN, 0};
  if (::poll(&pfd, 1, timeoutMs) > 0) {
    uint8_t buf[4096];
    for (;;) {
      const ssize_t n = ::recv(fd, buf, sizeof buf, 0);
      if (n > 0) {
        g_ns.rx.insert(g_ns.rx.end(), buf, buf + n);
        continue;
      }
      if (n == 0 || (errno != EAGAIN && errno != EWOULDBLOCK)) *lost = true;
      break;
    }
  }
  size_t off = 0;
  const uint32_t now = nowMs();
  while (g_ns.rx.size() - off >= sizeof(NetMsg)) {
    NetMsg m;
    std::memcpy(&m, g_ns.rx.data() + off, sizeof m);
    off += sizeof m;
    if (m.frame != g_ns.remoteKnown) continue;  // TCP entrega en orden: solo puede ser el siguiente
    g_ns.remote[m.frame % kNetRing] = m.in;
    g_ns.remoteKnown = m.frame + 1;
    if (m.frame < g_ns.frame && !sameInput(m.in, g_ns.used[m.frame % kNetRing]) && m.frame < rollbackFrom) {
      rollbackFrom = m.frame;
    }
    if (m.echoMs) {
      const double rtt = double(uint32_t(now - m.echoMs));
      if (rtt < 5000) g_ns.ping = g_ns.ping < 0 ? rtt : g_ns.ping * 0.9 + rtt * 0.1;
    }
    g_ns.echoBase = m.sentMs;
    g_ns.echoAt = now;
  }
  g_ns.rx.erase(g_ns.rx.begin(), g_ns.rx.begin() + long(off));
  return rollbackFrom;
}

bool netSaveState(uint32_t k) {
  const size_t size = g_core.serializeSize();
  auto &slot = g_ns.states[k % kNetRing];
  slot.resize(size);
  return size && g_core.serialize(slot.data(), size);
}

// Hilo de emulación, con g_coreMutex tomado: prepara el frame g_ns.frame (el llamador lo emula)
void netStepLocked() {
  const int fd = g_netFd.load();
  bool lost = false;

  // 1) Entrada local para frame + retardo (se rellenan huecos si el retardo creció)
  const NetInput L = localInput();
  const uint32_t now = nowMs();
  while (g_ns.lastSent < g_ns.frame + g_ns.delay) {
    ++g_ns.lastSent;
    g_ns.local[g_ns.lastSent % kNetRing] = L;
    NetMsg m{};
    m.frame = g_ns.lastSent;
    m.in = L;
    m.sentMs = now ? now : 1;
    m.echoMs = g_ns.echoBase ? g_ns.echoBase + (now - g_ns.echoAt) : 0;
    if (!sendAll(fd, &m, sizeof m)) {
      netStopLocked("Conexión perdida con el otro jugador");
      return;
    }
  }

  // 2) Entradas del otro jugador; si alguna predicción falló, rollback
  uint32_t rb = netPump(fd, 0, &lost);
  // 3) Demasiado adelantados (o sin rollback): esperar a que lleguen
  const uint32_t limit = g_ns.window;
  const uint32_t t0 = nowMs();
  while (!lost && g_ns.frame >= g_ns.remoteKnown + limit) {
    if (uint32_t(nowMs() - t0) > uint32_t(kNetTimeoutMs)) {
      lost = true;
      break;
    }
    rb = std::min(rb, netPump(fd, 50, &lost));
  }
  if (lost) {
    netStopLocked("Conexión perdida con el otro jugador");
    return;
  }
  if (rb != UINT32_MAX && g_ns.window && rb >= kNetStart) {
    auto &state = g_ns.states[rb % kNetRing];
    if (!state.empty() && g_core.unserialize(state.data(), state.size())) {
      g_replaying = true;
      for (uint32_t k = rb; k < g_ns.frame; ++k) {
        if (k != rb) netSaveState(k);
        netApplyInputs(k);
        g_core.run();
      }
      g_replaying = false;
      ++g_ns.rollbacks;
    }
  }

  // 4) Retardo adaptable según el ping (ida = ping / 2; un frame = 16,7 ms)
  if (g_ns.ping >= 0) {
    g_netPingMs = int(g_ns.ping);
    const double oneWay = g_ns.ping / 2.0 / 16.7;
    const uint32_t target = g_ns.window ? uint32_t(std::clamp(oneWay * 0.5, 1.0, 3.0))
                                        : uint32_t(std::clamp(std::ceil(oneWay) + 1.0, 2.0, 12.0));
    if (target != g_ns.delay) {
      g_ns.delay = target;
      netSetStatus("playing", netPlayingMessage());
    }
  }

  // 5) Estado antes de este frame (para poder volver) y entradas
  if (g_ns.window) netSaveState(g_ns.frame);
  netApplyInputs(g_ns.frame);
  ++g_ns.frame;
}

void runLoop() {
  using clock = std::chrono::steady_clock;
  const auto period =
      std::chrono::duration_cast<clock::duration>(std::chrono::duration<double>(1.0 / g_fps));
  auto next = clock::now();
  while (g_running) {
    if (!g_paused) {
      std::lock_guard<std::mutex> lock(g_coreMutex);
      if (g_gameLoaded) {
        if (g_netPending) netBeginLocked();
        if (g_netActive) netStepLocked();
        if (g_audioStatus) g_audioStatus(true, g_audio.occupancy(), g_audio.underrunLikely());
        g_core.run();
      }
    }
    next += period;
    const auto now = clock::now();
    if (next > now) {
      std::this_thread::sleep_until(next);
    } else if (now - next > std::chrono::milliseconds(100)) {
      next = now;  // nos hemos retrasado mucho: resincronizar en vez de acelerar
    }
  }
}

}  // namespace

// ---- API pública ----------------------------------------------------------

void configure(const char *systemDir, const char *saveDir, const char *stateDir) {
  g_systemDir = systemDir;
  g_saveDir = saveDir;
  g_stateDir = stateDir;
}

bool loadCore(const char *frameworkBinaryPath) {
  stop();
  {
    std::lock_guard<std::mutex> lock(g_coreMutex);
    unloadGameLocked();
    if (g_core.handle) {
      g_core.deinit();
      dlclose(g_core.handle);
    }
    g_core = CoreApi{};
  }

  g_isN64 = std::strstr(frameworkBinaryPath, "mupen64") != nullptr;
  // Formato por defecto de Libretro: un core que no llame a SET_PIXEL_FORMAT no debe heredar
  // el del core anterior (colores/columnas corruptas)
  g_pixelFormat = RETRO_PIXEL_FORMAT_0RGB1555;
  g_audioStatus = nullptr;  // lo vuelve a registrar el core nuevo si lo usa
  {
    const std::string fw(frameworkBinaryPath);
    const auto slash = fw.find_last_of('/');
    g_coreFile = slash == std::string::npos ? fw : fw.substr(slash + 1);
  }
  void *handle = dlopen(frameworkBinaryPath, RTLD_NOW | RTLD_LOCAL);
  if (!handle) {
    g_lastError = std::string("No se pudo cargar el núcleo: ") + dlerror();
    std::fprintf(stderr, "[libretro] dlopen: %s\n", dlerror());
    return false;
  }

  CoreApi c;
  c.handle = handle;
#define LOAD_SYM(field, symbol) c.field = reinterpret_cast<decltype(c.field)>(dlsym(handle, symbol))
  LOAD_SYM(init, "retro_init");
  LOAD_SYM(deinit, "retro_deinit");
  LOAD_SYM(setEnvironment, "retro_set_environment");
  LOAD_SYM(setVideoRefresh, "retro_set_video_refresh");
  LOAD_SYM(setAudioSampleBatch, "retro_set_audio_sample_batch");
  LOAD_SYM(setAudioSample, "retro_set_audio_sample");
  LOAD_SYM(setInputPoll, "retro_set_input_poll");
  LOAD_SYM(setInputState, "retro_set_input_state");
  LOAD_SYM(setControllerPortDevice, "retro_set_controller_port_device");
  LOAD_SYM(getSystemInfo, "retro_get_system_info");
  LOAD_SYM(getSystemAvInfo, "retro_get_system_av_info");
  LOAD_SYM(loadGame, "retro_load_game");
  LOAD_SYM(unloadGame, "retro_unload_game");
  LOAD_SYM(run, "retro_run");
  LOAD_SYM(reset, "retro_reset");
  LOAD_SYM(serializeSize, "retro_serialize_size");
  LOAD_SYM(serialize, "retro_serialize");
  LOAD_SYM(unserialize, "retro_unserialize");
  LOAD_SYM(getMemoryData, "retro_get_memory_data");
  LOAD_SYM(getMemorySize, "retro_get_memory_size");
#undef LOAD_SYM

  if (!c.complete()) {
    std::fprintf(stderr, "[libretro] el binario no exporta la API completa\n");
    dlclose(handle);
    return false;
  }

  // El orden importa: el entorno se registra antes de init()
  c.setEnvironment(onEnvironment);
  c.setVideoRefresh(onVideo);
  c.setAudioSampleBatch(onAudioBatch);
  if (c.setAudioSample) c.setAudioSample(onAudioSample);
  c.setInputPoll(onInputPoll);
  c.setInputState(onInputState);
  c.init();

  std::lock_guard<std::mutex> lock(g_coreMutex);
  g_core = c;
  return true;
}

bool loadGame(const char *romPath) {
  g_lastError.clear();
  g_coreLog.clear();
  if (!romPath || !*romPath) {
    g_lastError = "Ruta de ROM vacía";
    return false;
  }
  std::fprintf(stderr, "[RetroEmu] loadGame path=%s\n", romPath);
  if (!g_core.handle) {
    g_lastError = "No hay ningún núcleo cargado";
    return false;
  }
  stop();

  std::lock_guard<std::mutex> lock(g_coreMutex);
  unloadGameLocked();

  const std::string path = romPath;
  const auto slash = path.find_last_of('/');
  const std::string file = slash == std::string::npos ? path : path.substr(slash + 1);
  const auto dot = file.find_last_of('.');
  g_romBase = dot == std::string::npos ? file : file.substr(0, dot);
  g_romPath = romPath;

  retro_system_info info{};
  g_core.getSystemInfo(&info);

  retro_game_info game{};
  game.path = romPath;
  if (!info.need_fullpath) {
    if (!readFile(path, g_romData)) {
      g_lastError = "No se pudo leer el archivo de la ROM: " + path;
      std::fprintf(stderr, "[libretro] no se pudo leer %s\n", romPath);
      return false;
    }
    game.data = g_romData.data();
    game.size = g_romData.size();
  }
  if (!g_core.loadGame(&game)) {
    // Diagnóstico visible en la app: núcleo, ruta exacta y tamaño verificado en disco
    struct stat st {};
    const long long fileSize = stat(path.c_str(), &st) == 0 ? static_cast<long long>(st.st_size) : -1;
    const char *coreName = info.library_name ? info.library_name : "desconocido";
    std::fprintf(stderr, "[RetroEmu] retro_load_game=false core=%s path=%s size=%lld\n",
                 coreName, romPath, fileSize);
    g_lastError = std::string("El núcleo ") + coreName + " no ha aceptado la ROM (retro_load_game devolvió false).\n" +
                  "Ruta: " + path + "\nTamaño: " + std::to_string(fileSize) + " bytes\n" +
                  (g_coreLog.empty() ? std::string() : "Motivo del núcleo: " + g_coreLog + "\n") +
                  "Comprueba que el archivo esté completo y sea de la consola correcta.";
    return false;
  }
  g_gameLoaded = true;

  retro_system_av_info av{};
  g_core.getSystemAvInfo(&av);
  g_sampleRate = av.timing.sample_rate > 0 ? av.timing.sample_rate : 32768.0;
  g_fps = av.timing.fps > 0 ? av.timing.fps : 60.0;
  updateAspect(av.geometry);

  // N64: el puerto se declara como RETRO_DEVICE_ANALOG para que Mupen lea el stick
  g_core.setControllerPortDevice(0, g_isN64 ? RETRO_DEVICE_ANALOG : RETRO_DEVICE_JOYPAD);
  restoreSram();
  return true;
}

void unloadGame() {
  stop();
  std::lock_guard<std::mutex> lock(g_coreMutex);
  unloadGameLocked();
}

void start() {
  if (!g_gameLoaded || g_running.exchange(true)) return;
  g_audio.start(48000.0);
  g_thread = std::thread(runLoop);
}

void stop() {
  netStopLocked("Sin conexión");  // desbloquea un recv pendiente del hilo de emulación
  g_running = false;
  if (g_thread.joinable()) g_thread.join();
  g_audio.stop();
  persistSram();
}

void setPaused(bool paused) { g_paused = paused; }

void setButtons(uint16_t mask) {
  g_buttons = mask;
  g_dbgUiHits.fetch_or(mask, std::memory_order_relaxed);  // acumula también toques breves
}

void setAnalog(double x, double y) {
  auto toAxis = [](double v) {
    v = std::max(-1.0, std::min(1.0, v));
    return static_cast<int16_t>(v * 32767.0);
  };
  g_axisX = toAxis(x);
  g_axisY = toAxis(y);
}

void setPointer(double x, double y, bool pressed) {
  auto toCoord = [](double v) {
    v = std::max(-1.0, std::min(1.0, v));
    return static_cast<int16_t>(v * 32767.0);
  };
  g_pointerX = toCoord(x);
  g_pointerY = toCoord(y);
  g_pointerDown = pressed;
}

void setGamepad(uint16_t buttons, double x, double y) {
  auto toAxis = [](double v) {
    v = std::max(-1.0, std::min(1.0, v));
    return static_cast<int16_t>(v * 32767.0);
  };
  g_padButtons = buttons;
  g_padX = toAxis(x);
  g_padY = toAxis(y);
}

void setGamepadExtra(double rx, double ry, double l2, double r2) {
  auto toAxis = [](double v) {
    v = std::max(-1.0, std::min(1.0, v));
    return static_cast<int16_t>(v * 32767.0);
  };
  g_padRX = toAxis(rx);
  g_padRY = toAxis(ry);
  g_padL2 = toAxis(l2);
  g_padR2 = toAxis(r2);
}

void setRumbleHandler(void (*handler)(unsigned port, float strong, float weak)) { g_rumbleHandler = handler; }

void setGamepadPort(int port, uint16_t buttons, double x, double y, double rx, double ry, double l2, double r2) {
  if (port == 0) {
    setGamepad(buttons, x, y);
    setGamepadExtra(rx, ry, l2, r2);
    return;
  }
  if (port != 1) return;
  auto toAxis = [](double v) {
    v = std::max(-1.0, std::min(1.0, v));
    return static_cast<int16_t>(v * 32767.0);
  };
  g_pad2Buttons = buttons;
  g_pad2X = toAxis(x);
  g_pad2Y = toAxis(y);
  g_pad2RX = toAxis(rx);
  g_pad2RY = toAxis(ry);
  g_pad2L2 = toAxis(l2);
  g_pad2R2 = toAxis(r2);
}

std::string localAddress() {
  std::string best;
  ifaddrs *list = nullptr;
  if (::getifaddrs(&list) != 0) return best;
  for (ifaddrs *a = list; a; a = a->ifa_next) {
    if (!a->ifa_addr || a->ifa_addr->sa_family != AF_INET || (a->ifa_flags & IFF_LOOPBACK)) continue;
    char ip[INET_ADDRSTRLEN] = {};
    ::inet_ntop(AF_INET, &reinterpret_cast<sockaddr_in *>(a->ifa_addr)->sin_addr, ip, sizeof ip);
    // Wi-Fi (en0) primero; si no, la primera interfaz activa (datos móviles, hotspot…)
    if (std::strcmp(a->ifa_name, "en0") == 0) {
      best = ip;
      break;
    }
    if (best.empty()) best = ip;
  }
  ::freeifaddrs(list);
  return best;
}

std::string netStatus() {
  std::lock_guard<std::mutex> lock(g_netMutex);
  // fase|mensaje|código de sala|ping en ms (-1 = desconocido)
  return g_netStatus + "|" + g_netCode + "|" + std::to_string(g_netPingMs.load());
}

void netStop() { netStopLocked("Sin conexión"); }

bool netHost(int port) {
  if (!g_gameLoaded) return false;
  netStopLocked("Sin conexión");
  const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return false;
  int one = 1;
  ::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(uint16_t(port));
  addr.sin_addr.s_addr = htonl(INADDR_ANY);
  if (::bind(fd, reinterpret_cast<sockaddr *>(&addr), sizeof addr) != 0 || ::listen(fd, 1) != 0) {
    ::close(fd);
    netSetStatus("idle", "No se pudo abrir el puerto " + std::to_string(port));
    return false;
  }
  g_netListenFd = fd;
  g_netRole = 1;
  netSetStatus("waiting", "Esperando al Jugador 2 en " + localAddress() + ":" + std::to_string(port));
  const NetHello mine = makeHello();
  std::thread([fd, mine]() {
    while (g_netListenFd.load() == fd) {
      pollfd pfd{fd, POLLIN, 0};
      if (::poll(&pfd, 1, 500) <= 0) continue;
      const int client = ::accept(fd, nullptr, nullptr);
      if (client < 0) break;
      tuneSocket(client);
      std::string why;
      if (!hostHandshake(client, mine, why)) {
        ::close(client);
        netSetStatus("waiting", why + ". Sigue esperando…");
        continue;
      }
      closeFd(g_netListenFd);
      return;
    }
  }).detach();
  return true;
}

bool netHostRelay(const char *relayHost, int relayPort) {
  if (!g_gameLoaded || !relayHost) return false;
  netStopLocked("Sin conexión");
  g_netRole = 1;
  netSetStatus("connecting", "Creando sala en el servidor…");
  const NetHello mine = makeHello();
  const std::string relay(relayHost);
  std::thread([relay, relayPort, mine]() {
    std::string error, line;
    const int fd = connectTcp(relay, relayPort, 8000, error);
    if (fd < 0) {
      netStopLocked("Servidor de salas no disponible: " + error);
      return;
    }
    const char hello[] = "JLRL1 HOST\n";
    if (!sendAll(fd, hello, sizeof hello - 1) || !recvLine(fd, line, 10000) || line.rfind("CODE ", 0) != 0) {
      ::close(fd);
      netStopLocked("El servidor de salas no respondió");
      return;
    }
    const std::string code = line.substr(5);
    {
      std::lock_guard<std::mutex> lock(g_netMutex);
      g_netCode = code;
    }
    g_netListenFd = fd;  // netStop() lo cierra y cancela la espera
    netSetStatus("waiting", "Sala " + code + " · comparte el código con el Jugador 2");
    // Espera al Jugador 2 (la sala dura hasta 1 hora en el servidor)
    while (g_netListenFd.load() == fd) {
      pollfd pfd{fd, POLLIN, 0};
      if (::poll(&pfd, 1, 500) <= 0) continue;
      if (!recvLine(fd, line, 2000)) break;
      if (line == "PING") continue;
      if (line != "PAIRED") break;
      g_netListenFd = -1;  // el socket pasa a ser el de la partida
      std::string why;
      if (!hostHandshake(fd, mine, why)) {
        ::close(fd);
        netStopLocked(why);
      }
      return;
    }
    if (g_netListenFd.load() == fd) netStopLocked("La sala se cerró en el servidor");
  }).detach();
  return true;
}

bool netJoin(const char *address, int port) {
  if (!g_gameLoaded || !address) return false;
  netStopLocked("Sin conexión");
  g_netRole = 2;
  netSetStatus("connecting", std::string("Conectando con ") + address + "…");
  const NetHello mine = makeHello();
  const std::string host(address);
  std::thread([host, port, mine]() {
    std::string error;
    const int fd = connectTcp(host, port, 8000, error);
    if (fd < 0) {
      netStopLocked(error + ". ¿Sala creada en el otro iPhone y puerto abierto?");
      return;
    }
    clientHandshake(fd, mine);
  }).detach();
  return true;
}

bool netJoinCode(const char *code, const char *relayHost, int relayPort) {
  if (!g_gameLoaded || !code || !relayHost) return false;
  netStopLocked("Sin conexión");
  g_netRole = 2;
  netSetStatus("connecting", std::string("Buscando la sala ") + code + "…");
  const NetHello mine = makeHello();
  const std::string relay(relayHost), room(code);
  std::thread([relay, relayPort, room, mine]() {
    std::string error, line;
    const int fd = connectTcp(relay, relayPort, 8000, error);
    if (fd < 0) {
      netStopLocked("Servidor de salas no disponible: " + error);
      return;
    }
    const std::string join = "JLRL1 JOIN " + room + "\n";
    if (!sendAll(fd, join.data(), join.size()) || !recvLine(fd, line, 10000)) {
      ::close(fd);
      netStopLocked("El servidor de salas no respondió");
      return;
    }
    if (line != "PAIRED") {
      ::close(fd);
      netStopLocked(line.rfind("ERR ", 0) == 0 ? line.substr(4) : "No se pudo entrar en la sala");
      return;
    }
    {
      std::lock_guard<std::mutex> lock(g_netMutex);
      g_netCode = room;
    }
    clientHandshake(fd, mine);
  }).detach();
  return true;
}

void reset() {
  std::lock_guard<std::mutex> lock(g_coreMutex);
  if (g_gameLoaded) g_core.reset();
}

bool saveState(int slot) {
  std::lock_guard<std::mutex> lock(g_coreMutex);
  if (!g_gameLoaded) return false;
  const size_t size = g_core.serializeSize();
  if (!size) return false;
  std::vector<uint8_t> buf(size);
  if (!g_core.serialize(buf.data(), size)) return false;
  std::ofstream f(statePath(slot), std::ios::binary);
  if (!f) return false;
  f.write(reinterpret_cast<const char *>(buf.data()), std::streamsize(size));
  return bool(f);
}

bool loadState(int slot) {
  std::lock_guard<std::mutex> lock(g_coreMutex);
  if (!g_gameLoaded || g_netActive) return false;
  std::vector<uint8_t> buf;
  if (!readFile(statePath(slot), buf) && !readFile(legacyStatePath(slot), buf)) return false;
  return g_core.unserialize(buf.data(), buf.size());
}

FrameBuffer &frame() { return g_frame; }

float aspectRatio() { return g_aspect.load(std::memory_order_relaxed); }

void setOption(const char *key, const char *value) {
  if (!key || !value) return;
  {
    std::lock_guard<std::mutex> lock(g_optionsMutex);
    auto &slot = g_userOptions[key];
    if (slot == value) return;
    slot = value;
  }
  g_optionsDirty = true;
}

std::string lastError() { return g_lastError; }

// Instantánea para la pantalla de depuración: lo que escribe la UI y lo que pidió el core
std::string debugState() {
  const uint32_t hits = g_dbgJoyHits.exchange(0, std::memory_order_relaxed);
  const uint32_t reads = g_dbgReads.exchange(0, std::memory_order_relaxed);
  const uint32_t uiHits = g_dbgUiHits.exchange(0, std::memory_order_relaxed);
  char buf[512];
  std::snprintf(buf, sizeof(buf),
                "UI ahora btn=%04x pad=%04x ax=%d ay=%d\n"
                "UI pulsado (ult. 0.5s) btn=%04x\n"
                "core pidió (ult. 0.5s) btn=%04x lecturas=%u\n"
                "stick devuelto x=%d y=%d\n"
                "frame %ux%u pitch=%u (esperado %u)\n"
                "color col0=#%06x col1=#%06x centro=#%06x",
                g_buttons.load(), g_padButtons.load(), g_axisX.load(), g_axisY.load(), uiHits, hits,
                reads, g_dbgAxisX.load(), g_dbgAxisY.load(), g_dbgFrameW.load(), g_dbgFrameH.load(),
                g_dbgFramePitch.load(), g_dbgFrameW.load() * g_dbgFrameBpp.load(), g_dbgCol0.load(),
                g_dbgCol1.load(), g_dbgColMid.load());
  return buf;
}

}  // namespace host
