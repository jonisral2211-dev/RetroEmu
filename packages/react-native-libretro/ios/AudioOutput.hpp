#pragma once

#include <AudioToolbox/AudioToolbox.h>

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <vector>

// Salida de audio con AudioQueue (C API, sin Objective-C).
// Productor: hilo de emulación (push). Consumidor: hilo del sistema de audio (onBuffer).
// Remuestrea de la tasa del core a 48 kHz estéreo float con interpolación lineal.
class AudioOutput {
 public:
  bool start(double outRate);
  void stop();
  void push(const int16_t *stereo, size_t frames, double inRate);

 private:
  static void onBuffer(void *user, AudioQueueRef queue, AudioQueueBufferRef buffer);
  void fill(float *dst, size_t frames);

  static constexpr size_t kCapacity = 1u << 15;  // frames en el ring buffer (~0.7 s)
  static constexpr int kBuffers = 3;
  static constexpr size_t kBufferFrames = 512;

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
};
