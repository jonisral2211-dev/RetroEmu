#pragma once

#include <AudioToolbox/AudioToolbox.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <cstddef>
#include <cstdint>
#include <vector>

// Salida de audio con AudioQueue (C API, sin Objective-C).
// Productor: hilo de emulación (push). Consumidor: hilo del sistema de audio (onBuffer).
// Remuestrea de la tasa del core a 48 kHz estéreo float con interpolación lineal y
// control dinámico de tasa (DRC, como RetroArch): la relación de remuestreo se ajusta
// ±0,5 % según el llenado del búfer para que no se vacíe (cortes) ni se llene (saltos).
class AudioOutput {
 public:
  bool start(double outRate);
  void stop();
  void push(const int16_t *stereo, size_t frames, double inRate);
  /** Llenado del ring en % (100 = el doble del objetivo). Lo usa el frameskip automático. */
  unsigned occupancy() const;
  /** true si el ring está por debajo de medio objetivo: el core debería saltarse un frame. */
  bool underrunLikely() const;
  /** Segundos de audio pendientes de sonar (ring + búferes ya encolados en AudioQueue). */
  double bufferedSeconds() const;
  /**
   * Reloj maestro (como RetroEmu/RetroArch "audio sync"): bloquea al hilo de emulación mientras
   * haya más de maxSeconds de audio pendiente. Así el juego nunca puede ir a más de 1.00x
   * aunque el temporizador o la pantalla (120 Hz) vayan más rápido. Espera como mucho `limit`
   * (si el audio está parado, p. ej. en segundo plano, no se cuelga). Devuelve true si esperó.
   */
  bool waitForRoom(double maxSeconds, std::chrono::milliseconds limit);
  bool running() const { return queue_ != nullptr && primed_; }

 private:
  static void onBuffer(void *user, AudioQueueRef queue, AudioQueueBufferRef buffer);
  void fill(float *dst, size_t frames);

  static constexpr size_t kCapacity = 1u << 15;  // frames en el ring buffer (~0.7 s)
  static constexpr int kBuffers = 3;
  static constexpr size_t kBufferFrames = 1024;  // ~21 ms por búfer de AudioQueue
  static constexpr double kTargetSeconds = 0.05; // llenado objetivo del ring (50 ms)
  static constexpr double kMaxRateDelta = 0.005; // ajuste máximo de la tasa (DRC)

  AudioQueueRef queue_ = nullptr;
  AudioQueueBufferRef buffers_[kBuffers] = {};
  double outRate_ = 48000.0;

  std::vector<float> ring_ = std::vector<float>(kCapacity * 2);
  std::atomic<uint64_t> readIdx_{0};
  std::atomic<uint64_t> writeIdx_{0};

  double pos_ = 0.0;  // fase del remuestreador respecto al bloque actual
  float prevL_ = 0.0f;
  float prevR_ = 0.0f;
  std::vector<float> scratch_;

  // Consumidor: tras un vaciado espera a tener medio objetivo antes de volver a sonar, y
  // mientras tanto desvanece la última muestra (sin chasquido por corte seco)
  std::atomic<bool> primed_{false};
  // Despierta al productor bloqueado en waitForRoom cada vez que suena un búfer
  mutable std::mutex waitMutex_;
  std::condition_variable roomCv_;
  float lastL_ = 0.0f;
  float lastR_ = 0.0f;
};
