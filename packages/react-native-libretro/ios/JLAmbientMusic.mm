#import "JLAmbientMusic.h"

#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>

#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

namespace {

// Progresión (semitonos sobre La 2 = 110 Hz): Am7 - Fmaj7 - Cmaj7 - G6, dos compases cada uno
const int kChords[4][4] = {
    {0, 3, 7, 10},   // Am7
    {-4, 0, 3, 7},   // Fmaj7
    {3, 7, 10, 14},  // Cmaj7
    {-2, 2, 5, 9},   // G6
};
const int kRoots[4] = {0, -4, 3, -2};
// Patrón del arpegio (índice de nota del acorde; -1 = silencio), corcheas
const int kArp[16] = {0, 2, 1, 3, 2, 1, -1, 2, 0, 3, 2, 1, 3, -1, 2, 1};

inline float midiHz(float semis) { return 110.0f * std::pow(2.0f, semis / 12.0f); }

struct Synth {
  double sr = 48000.0;
  uint64_t frame = 0;
  float gain = 0.0f;  // fundido de entrada/salida
  std::atomic<float> target{0.0f};
  std::atomic<float> volume{0.5f};
  // Pad: 4 voces x 2 osciladores ligeramente desafinados
  float padPhase[4][2] = {};
  float padLp = 0.0f;
  // Arpegio: onda cuadrada con envolvente de pulsación
  float arpPhase = 0.0f;
  float arpHz = 440.0f;
  float arpEnv = 0.0f;
  // Bajo senoidal
  float bassPhase = 0.0f;
  float bassEnv = 0.0f;
  int64_t lastStep = -1;
  int64_t lastBar = -1;
  // Eco estéreo (3/16 de compás) para dar espacio
  std::vector<float> delayL, delayR;
  size_t delayPos = 0;
  uint32_t rng = 0x1234567u;

  float rand01() {
    rng ^= rng << 13;
    rng ^= rng >> 17;
    rng ^= rng << 5;
    return (rng & 0xffffff) / float(0x1000000);
  }

  void prepare(double rate) {
    sr = rate;
    const size_t len = size_t(rate * 0.62);
    delayL.assign(len, 0.0f);
    delayR.assign(len, 0.0f);
    delayPos = 0;
  }

  void render(float *L, float *R, uint32_t n) {
    const double beat = 60.0 / 72.0;           // 72 BPM
    const double eighth = beat / 2.0;
    const double chordLen = beat * 8.0;        // dos compases de 4/4
    const float vol = volume.load(std::memory_order_relaxed);
    const float tgt = target.load(std::memory_order_relaxed);
    for (uint32_t i = 0; i < n; ++i, ++frame) {
      const double t = double(frame) / sr;
      const int chord = int(t / chordLen) % 4;
      const double inChord = std::fmod(t, chordLen);
      // Fundido suave entre acordes (los primeros 1.2 s)
      const float xfade = float(std::min(1.0, inChord / 1.2));

      // Pad: triángulo + sierra suavizada, en una octava media
      float pad = 0.0f;
      for (int v = 0; v < 4; ++v) {
        const float hz = midiHz(float(kChords[chord][v] + 12));
        for (int o = 0; o < 2; ++o) {
          const float det = o ? 1.004f : 0.996f;
          float &ph = padPhase[v][o];
          ph += hz * det / float(sr);
          if (ph >= 1.0f) ph -= 1.0f;
          const float tri = 4.0f * std::fabs(ph - 0.5f) - 1.0f;
          pad += tri * 0.6f + (2.0f * ph - 1.0f) * 0.15f;
        }
      }
      pad *= 0.055f * (0.55f + 0.45f * xfade);
      padLp += (pad - padLp) * 0.06f;  // paso bajo: sin aristas

      // Arpegio en corcheas
      const int64_t step = int64_t(t / eighth);
      if (step != lastStep) {
        lastStep = step;
        const int idx = kArp[step % 16];
        if (idx >= 0) {
          const int octave = rand01() < 0.25f ? 36 : 24;
          arpHz = midiHz(float(kChords[chord][idx] + octave));
          arpEnv = 0.75f + 0.25f * rand01();
        }
      }
      arpPhase += arpHz / float(sr);
      if (arpPhase >= 1.0f) arpPhase -= 1.0f;
      const float square = arpPhase < 0.25f ? 1.0f : -0.35f;  // pulso 25 % (sonido NES suave)
      const float arp = square * arpEnv * 0.03f;
      arpEnv *= 0.99965f;

      // Bajo: nota raíz en cada compás
      const int64_t bar = int64_t(t / (beat * 4.0));
      if (bar != lastBar) {
        lastBar = bar;
        bassEnv = 1.0f;
      }
      bassPhase += midiHz(float(kRoots[chord] - 12)) / float(sr);
      if (bassPhase >= 1.0f) bassPhase -= 1.0f;
      const float bass = std::sin(bassPhase * 6.2831853f) * bassEnv * 0.07f;
      bassEnv *= 0.99993f;

      // Eco cruzado (ping-pong) solo del arpegio
      const float dl = delayL[delayPos];
      const float dr = delayR[delayPos];
      delayL[delayPos] = arp + dr * 0.42f;
      delayR[delayPos] = dl * 0.42f;
      delayPos = (delayPos + 1) % delayL.size();

      gain += (tgt - gain) * 0.00008f;  // ~0.3 s de fundido
      const float g = gain * vol;
      L[i] = (padLp + bass + arp * 0.8f + dl * 0.6f) * g;
      R[i] = (padLp + bass + arp * 0.6f + dr * 0.6f) * g;
    }
  }
};

}  // namespace

@implementation JLAmbientMusic {
  AVAudioEngine *_engine;
  AVAudioSourceNode *_source;
  Synth *_synth;
  BOOL _wanted;
  BOOL _otherAudio;
  BOOL _playing;
}

+ (instancetype)shared {
  static JLAmbientMusic *shared;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    shared = [JLAmbientMusic new];
  });
  return shared;
}

- (instancetype)init {
  if (self = [super init]) {
    _synth = new Synth();
    NSNotificationCenter *nc = NSNotificationCenter.defaultCenter;
    [nc addObserver:self
           selector:@selector(silenceHint:)
               name:AVAudioSessionSilenceSecondaryAudioHintNotification
             object:nil];
    [nc addObserver:self selector:@selector(interrupted:) name:AVAudioSessionInterruptionNotification object:nil];
    [nc addObserver:self selector:@selector(becameActive) name:UIApplicationDidBecomeActiveNotification object:nil];
  }
  return self;
}

- (void)silenceHint:(NSNotification *)note {
  const NSUInteger type = [note.userInfo[AVAudioSessionSilenceSecondaryAudioHintTypeKey] unsignedIntegerValue];
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_otherAudio = type == AVAudioSessionSilenceSecondaryAudioHintTypeBegin;
    [self update];
  });
}

- (void)interrupted:(NSNotification *)note {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_playing = NO;
    [self update];
  });
}

- (void)becameActive {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self update];
  });
}

- (void)setWanted:(BOOL)wanted {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_wanted = wanted;
    [self update];
  });
}

- (void)setVolume:(float)volume {
  _synth->volume.store(fmaxf(0.0f, fminf(1.0f, volume)));
}

- (NSString *)status {
  return [NSString stringWithFormat:@"{\"wanted\":%@,\"playing\":%@,\"otherAudio\":%@}", _wanted ? @"true" : @"false",
                                    _playing ? @"true" : @"false", _otherAudio ? @"true" : @"false"];
}

- (BOOL)ensureEngine {
  if (_engine) return YES;
  AVAudioEngine *engine = [AVAudioEngine new];
  const double rate = [engine.outputNode outputFormatForBus:0].sampleRate > 0 ? [engine.outputNode outputFormatForBus:0].sampleRate
                                                                               : 48000.0;
  _synth->prepare(rate);
  AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:rate channels:2];
  Synth *synth = _synth;
  AVAudioSourceNode *source = [[AVAudioSourceNode alloc]
      initWithFormat:format
         renderBlock:^OSStatus(BOOL *isSilence, const AudioTimeStamp *ts, AVAudioFrameCount count, AudioBufferList *out) {
           if (out->mNumberBuffers < 2) return noErr;
           synth->render(static_cast<float *>(out->mBuffers[0].mData), static_cast<float *>(out->mBuffers[1].mData), count);
           return noErr;
         }];
  [engine attachNode:source];
  [engine connect:source to:engine.mainMixerNode format:format];
  _engine = engine;
  _source = source;
  return YES;
}

// Suena solo si se quiere y ninguna otra app está reproduciendo audio
- (void)update {
  const BOOL shouldPlay = _wanted && !_otherAudio && !AVAudioSession.sharedInstance.secondaryAudioShouldBeSilencedHint &&
                          UIApplication.sharedApplication.applicationState == UIApplicationStateActive;
  if (shouldPlay) {
    if (!_playing) {
      NSError *error = nil;
      AVAudioSession *session = AVAudioSession.sharedInstance;
      [session setCategory:AVAudioSessionCategoryAmbient withOptions:AVAudioSessionCategoryOptionMixWithOthers error:&error];
      [session setActive:YES error:nil];
      [self ensureEngine];
      _synth->target.store(1.0f);
      _playing = [_engine startAndReturnError:&error];
    }
  } else if (_playing) {
    _synth->target.store(0.0f);
    _playing = NO;
    AVAudioEngine *engine = _engine;
    // Deja terminar el fundido de salida antes de parar el motor
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.45 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (!self->_playing) [engine pause];
    });
  }
}

@end
