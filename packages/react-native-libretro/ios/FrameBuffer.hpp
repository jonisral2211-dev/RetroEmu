#pragma once

#include <cstddef>
#include <cstdint>
#include <mutex>
#include <vector>

// Último frame producido por el core, en BGRA8. El hilo de emulación escribe;
// la vista Metal lee (bajo el mismo mutex) cuando `version` cambia.
struct FrameBuffer {
  std::mutex mutex;
  std::vector<uint8_t> pixels;
  uint32_t width = 0;
  uint32_t height = 0;
  uint32_t version = 0;

  template <class Fill>
  void write(uint32_t w, uint32_t h, Fill &&fill) {
    std::lock_guard<std::mutex> lock(mutex);
    pixels.resize(size_t(w) * size_t(h) * 4);
    fill(pixels.data());
    width = w;
    height = h;
    ++version;
  }
};
