#include "AudioOutput.hpp"

#include <algorithm>
#include <cmath>

bool AudioOutput::start(double outRate) {
  if (queue_) return true;

  outRate_ = outRate;
  pos_ = 0.0;
  prevL_ = prevR_ = 0.0f;
  lastL_ = lastR_ = 0.0f;
  primed_ = false;
  readIdx_ = 0;
  writeIdx_ = 0;
  std::fill(ring_.begin(), ring_.end(), 0.0f);

  AudioStreamBasicDescription fmt{};
  fmt.mSampleRate = outRate;
  fmt.mFormatID = kAudioFormatLinearPCM;
  fmt.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
  fmt.mChannelsPerFrame = 2;
  fmt.mBitsPerChannel = 32;
  fmt.mBytesPerFrame = 8;
  fmt.mBytesPerPacket = 8;
  fmt.mFramesPerPacket = 1;

  if (AudioQueueNewOutput(&fmt, onBuffer, this, nullptr, nullptr, 0, &queue_) != noErr) {
    queue_ = nullptr;
    return false;
  }

  for (int i = 0; i < kBuffers; ++i) {
    AudioQueueAllocateBuffer(queue_, kBufferFrames * 8, &buffers_[i]);
    onBuffer(this, queue_, buffers_[i]);  // primer llenado y encolado
  }
  return AudioQueueStart(queue_, nullptr) == noErr;
}

void AudioOutput::stop() {
  if (!queue_) return;
  AudioQueueStop(queue_, true);
  AudioQueueDispose(queue_, true);
  queue_ = nullptr;
}

void AudioOutput::push(const int16_t *in, size_t n, double inRate) {
  if (!queue_ || n == 0) return;

  // DRC: con el búfer por encima del objetivo se generan algo menos de muestras (paso mayor)
  // y por debajo algo más. El ajuste (±0,5 %) es inaudible y evita vaciados y desbordes.
  const uint64_t w0 = writeIdx_.load(std::memory_order_relaxed);
  const uint64_t r0 = readIdx_.load(std::memory_order_acquire);
  const double target = outRate_ * kTargetSeconds;
  const double fillLevel = double(w0 - r0);
  const double deviation = std::max(-1.0, std::min(1.0, (fillLevel - target) / target));
  const double step = (inRate / outRate_) * (1.0 + kMaxRateDelta * deviation);

  // Índice -1 = último frame del bloque anterior (prevL_/prevR_)
  auto at = [&](long i, int ch) -> float {
    if (i < 0) return ch ? prevR_ : prevL_;
    return in[size_t(i) * 2 + size_t(ch)] * (1.0f / 32768.0f);
  };

  scratch_.clear();
  double t = pos_;
  const double limit = double(n) - 1.0;
  while (t < limit) {
    const long i = long(std::floor(t));
    const float f = float(t - double(i));
    for (int ch = 0; ch < 2; ++ch) {
      const float a = at(i, ch);
      const float b = at(i + 1, ch);
      scratch_.push_back(a + (b - a) * f);
    }
    t += step;
  }
  pos_ = t - double(n);
  prevL_ = at(long(n) - 1, 0);
  prevR_ = at(long(n) - 1, 1);

  const uint64_t w = writeIdx_.load(std::memory_order_relaxed);
  const uint64_t r = readIdx_.load(std::memory_order_acquire);
  const size_t space = kCapacity - size_t(w - r);
  const size_t frames = std::min(space, scratch_.size() / 2);  // si no cabe, se descarta
  for (size_t k = 0; k < frames; ++k) {
    const size_t idx = size_t((w + k) % kCapacity) * 2;
    ring_[idx] = scratch_[k * 2];
    ring_[idx + 1] = scratch_[k * 2 + 1];
  }
  writeIdx_.store(w + frames, std::memory_order_release);
}

void AudioOutput::onBuffer(void *user, AudioQueueRef queue, AudioQueueBufferRef buffer) {
  auto *self = static_cast<AudioOutput *>(user);
  const size_t frames = buffer->mAudioDataBytesCapacity / 8;
  self->fill(static_cast<float *>(buffer->mAudioData), frames);
  buffer->mAudioDataByteSize = UInt32(frames * 8);
  AudioQueueEnqueueBuffer(queue, buffer, 0, nullptr);
}

unsigned AudioOutput::occupancy() const {
  const double fill = double(writeIdx_.load(std::memory_order_acquire) - readIdx_.load(std::memory_order_acquire));
  const double pct = fill / (outRate_ * kTargetSeconds * 2.0) * 100.0;
  return unsigned(std::min(100.0, std::max(0.0, pct)));
}

bool AudioOutput::underrunLikely() const {
  const double fill = double(writeIdx_.load(std::memory_order_acquire) - readIdx_.load(std::memory_order_acquire));
  return fill < outRate_ * kTargetSeconds * 0.5;
}

void AudioOutput::fill(float *dst, size_t frames) {
  const uint64_t w = writeIdx_.load(std::memory_order_acquire);
  const uint64_t r = readIdx_.load(std::memory_order_relaxed);
  const size_t available = size_t(w - r);
  if (!primed_ && double(available) >= outRate_ * kTargetSeconds * 0.5) primed_ = true;

  const size_t take = primed_ ? std::min(available, frames) : 0;
  for (size_t k = 0; k < take; ++k) {
    const size_t idx = size_t((r + k) % kCapacity) * 2;
    dst[k * 2] = ring_[idx];
    dst[k * 2 + 1] = ring_[idx + 1];
  }
  if (take > 0) {
    lastL_ = dst[(take - 1) * 2];
    lastR_ = dst[(take - 1) * 2 + 1];
  }
  // Vaciado: desvanecer la última muestra (~5 ms) en vez de saltar a 0 (chasquido)
  for (size_t k = take; k < frames; ++k) {
    lastL_ *= 0.995f;
    lastR_ *= 0.995f;
    dst[k * 2] = lastL_;
    dst[k * 2 + 1] = lastR_;
  }
  if (take < frames) primed_ = false;  // rellenar medio objetivo antes de volver a sonar
  readIdx_.store(r + take, std::memory_order_release);
}
