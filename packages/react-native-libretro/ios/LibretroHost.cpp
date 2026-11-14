#include "LibretroHost.hpp"

#include <dlfcn.h>
#include <sys/stat.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <fstream>
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
bool g_isN64 = false;
// Relación de aspecto de pantalla que declara el core (no la del buffer: PS1 usa píxeles no
// cuadrados). 0 = desconocida (se usa ancho/alto del frame).
std::atomic<float> g_aspect{0.0f};
FrameBuffer g_frame;
AudioOutput g_audio;

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

// Opciones de core forzadas por el frontend: máxima nitidez estable por software.
// Claves y valores verificados en libretro_core_options.h de cada core (upstream master).
const char *forcedOption(const char *key) {
  struct Opt {
    const char *key;
    const char *value;
  };
  static const Opt kOptions[] = {
      // PCSX ReARMed (GPU NEON): resolución interna x2, sin pasada extra de la imagen
      // principal (más rápido) y sin tramado (imagen limpia)
      {"pcsx_rearmed_neon_enhancement_enable", "enabled"},
      {"pcsx_rearmed_neon_enhancement_no_main", "enabled"},
      {"pcsx_rearmed_neon_enhancement_tex_adj_v2", "enabled"},
      {"pcsx_rearmed_dithering", "disabled"},
      // Genesis Plus GX: oculta la columna de 8 px que el VDP de Master System deja con basura
      // en el borde izquierdo (franja vertical), sin filtros NTSC/LCD que emborronan
      {"genesis_plus_gx_left_border", "left border"},
      {"genesis_plus_gx_blargg_ntsc_filter", "disabled"},
      {"genesis_plus_gx_lcd_filter", "disabled"},
      // Mupen64Plus (angrylion, RDP por software): antialiasing sin tramado, todos los hilos
      {"mupen64plus-angrylion-vioverlay", "AA+Dedither"},
      {"mupen64plus-angrylion-multithread", "all threads"},
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
    case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
      static_cast<struct retro_log_callback *>(data)->log = coreLog;
      return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
      *static_cast<bool *>(data) = false;
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
  });
}

static size_t onAudioBatch(const int16_t *data, size_t frames) {
  g_audio.push(data, frames, g_sampleRate);
  return frames;
}

static void onInputPoll(void) {}

static int16_t onInputState(unsigned port, unsigned device, unsigned index, unsigned id) {
  g_dbgReads.fetch_add(1, std::memory_order_relaxed);
  if (port != 0) return 0;
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

void runLoop() {
  using clock = std::chrono::steady_clock;
  const auto period =
      std::chrono::duration_cast<clock::duration>(std::chrono::duration<double>(1.0 / g_fps));
  auto next = clock::now();
  while (g_running) {
    if (!g_paused) {
      std::lock_guard<std::mutex> lock(g_coreMutex);
      if (g_gameLoaded) g_core.run();
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

void setGamepad(uint16_t buttons, double x, double y) {
  auto toAxis = [](double v) {
    v = std::max(-1.0, std::min(1.0, v));
    return static_cast<int16_t>(v * 32767.0);
  };
  g_padButtons = buttons;
  g_padX = toAxis(x);
  g_padY = toAxis(y);
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
  if (!g_gameLoaded) return false;
  std::vector<uint8_t> buf;
  if (!readFile(statePath(slot), buf) && !readFile(legacyStatePath(slot), buf)) return false;
  return g_core.unserialize(buf.data(), buf.size());
}

FrameBuffer &frame() { return g_frame; }

float aspectRatio() { return g_aspect.load(std::memory_order_relaxed); }

std::string lastError() { return g_lastError; }

// Instantánea para la pantalla de depuración: lo que escribe la UI y lo que pidió el core
std::string debugState() {
  const uint32_t hits = g_dbgJoyHits.exchange(0, std::memory_order_relaxed);
  const uint32_t reads = g_dbgReads.exchange(0, std::memory_order_relaxed);
  const uint32_t uiHits = g_dbgUiHits.exchange(0, std::memory_order_relaxed);
  char buf[400];
  std::snprintf(buf, sizeof(buf),
                "UI ahora btn=%04x pad=%04x ax=%d ay=%d\n"
                "UI pulsado (ult. 0.5s) btn=%04x\n"
                "core pidió (ult. 0.5s) btn=%04x lecturas=%u\n"
                "stick devuelto x=%d y=%d\n"
                "frame %ux%u pitch=%u (esperado %u)",
                g_buttons.load(), g_padButtons.load(), g_axisX.load(), g_axisY.load(), uiHits, hits,
                reads, g_dbgAxisX.load(), g_dbgAxisY.load(), g_dbgFrameW.load(), g_dbgFrameH.load(),
                g_dbgFramePitch.load(), g_dbgFrameW.load() * g_dbgFrameBpp.load());
  return buf;
}

}  // namespace host
