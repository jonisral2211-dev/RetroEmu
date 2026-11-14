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
  // Bytes por fila de `pixels` (BGRA8 empaquetado: width * 4). Es el bytesPerRow de Metal;
  // NO es el pitch del core, que puede llevar relleno y se descarta al convertir.
  size_t stride = 0;
  uint32_t version = 0;

  template <class Fill>
  void write(uint32_t w, uint32_t h, Fill &&fill) {
    std::lock_guard<std::mutex> lock(mutex);
    stride = size_t(w) * 4;
    pixels.resize(stride * size_t(h));
    fill(pixels.data(), stride);
    width = w;
    height = h;
    ++version;
  }
};
