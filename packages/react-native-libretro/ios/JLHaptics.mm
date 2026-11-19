#import "JLHaptics.h"

#import <CoreHaptics/CoreHaptics.h>
#import <UIKit/UIKit.h>

@implementation JLHaptics {
  dispatch_queue_t _queue;
  CHHapticEngine *_engine;
  BOOL _supported;
  NSMutableDictionary<NSString *, CHHapticPattern *> *_patterns;
  id<CHHapticAdvancedPatternPlayer> _rumble;
  float _rumbleLevel;
}

+ (instancetype)shared {
  static JLHaptics *shared;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    shared = [JLHaptics new];
  });
  return shared;
}

- (instancetype)init {
  if (self = [super init]) {
    _queue = dispatch_queue_create("jl.haptics", DISPATCH_QUEUE_SERIAL);
    _patterns = [NSMutableDictionary dictionary];
    _supported = CHHapticEngine.capabilitiesForHardware.supportsHaptics;
    _phoneRumbleEnabled = YES;
  }
  return self;
}

static CHHapticEventParameter *param(CHHapticEventParameterID ident, float value) {
  return [[CHHapticEventParameter alloc] initWithParameterID:ident value:value];
}

static CHHapticEvent *transient(float intensity, float sharpness, NSTimeInterval at) {
  return [[CHHapticEvent alloc] initWithEventType:CHHapticEventTypeHapticTransient
                                       parameters:@[
                                         param(CHHapticEventParameterIDHapticIntensity, intensity),
                                         param(CHHapticEventParameterIDHapticSharpness, sharpness),
                                       ]
                                     relativeTime:at];
}

// Patrones: se construyen una vez y se reproducen con un player barato cada vez
- (CHHapticPattern *)patternFor:(NSString *)kind {
  CHHapticPattern *cached = _patterns[kind];
  if (cached) return cached;
  NSArray<CHHapticEvent *> *events = nil;
  NSArray<CHHapticParameterCurve *> *curves = @[];
  if ([kind isEqualToString:@"click"]) {
    // Clic mecánico seco: golpe nítido y un rebote mínimo del muelle 12 ms después
    events = @[ transient(1.0, 0.95, 0), transient(0.32, 1.0, 0.012) ];
  } else if ([kind isEqualToString:@"trigger"]) {
    // Gatillo: resistencia suave que crece y se suelta (continuo grave con rampa)
    CHHapticEvent *body = [[CHHapticEvent alloc]
        initWithEventType:CHHapticEventTypeHapticContinuous
               parameters:@[
                 param(CHHapticEventParameterIDHapticIntensity, 0.55),
                 param(CHHapticEventParameterIDHapticSharpness, 0.12),
                 param(CHHapticEventParameterIDAttackTime, 0.05),
                 param(CHHapticEventParameterIDReleaseTime, 0.04),
               ]
             relativeTime:0
                 duration:0.11];
    events = @[ body, transient(0.45, 0.4, 0.07) ];
    CHHapticParameterCurve *ramp = [[CHHapticParameterCurve alloc]
        initWithParameterID:CHHapticDynamicParameterIDHapticIntensityControl
              controlPoints:@[
                [[CHHapticParameterCurveControlPoint alloc] initWithRelativeTime:0 value:0.3],
                [[CHHapticParameterCurveControlPoint alloc] initWithRelativeTime:0.07 value:1.0],
                [[CHHapticParameterCurveControlPoint alloc] initWithRelativeTime:0.11 value:0.2],
              ]
               relativeTime:0];
    curves = @[ ramp ];
  } else if ([kind isEqualToString:@"dpad"]) {
    events = @[ transient(0.55, 0.75, 0) ];
  } else if ([kind isEqualToString:@"success"]) {
    events = @[ transient(0.7, 0.5, 0), transient(0.9, 0.7, 0.09), transient(1.0, 0.9, 0.2) ];
  } else {
    events = @[ transient(0.4, 0.3, 0) ];
  }
  NSError *error = nil;
  CHHapticPattern *pattern = [[CHHapticPattern alloc] initWithEvents:events parameterCurves:curves error:&error];
  if (pattern) _patterns[kind] = pattern;
  return pattern;
}

- (BOOL)ensureEngine {
  if (!_supported) return NO;
  NSError *error = nil;
  if (!_engine) {
    _engine = [[CHHapticEngine alloc] initAndReturnError:&error];
    if (!_engine) {
      _supported = NO;
      return NO;
    }
    _engine.playsHapticsOnly = YES;
    _engine.autoShutdownEnabled = YES;
    __weak JLHaptics *weakSelf = self;
    _engine.resetHandler = ^{
      JLHaptics *strong = weakSelf;
      if (!strong) return;
      dispatch_async(strong->_queue, ^{
        strong->_rumble = nil;
        [strong->_engine startAndReturnError:nil];
      });
    };
    _engine.stoppedHandler = ^(CHHapticEngineStoppedReason reason) {
      JLHaptics *strong = weakSelf;
      if (!strong) return;
      dispatch_async(strong->_queue, ^{
        strong->_rumble = nil;
      });
    };
  }
  return [_engine startAndReturnError:&error];
}

- (void)fallback:(NSString *)kind {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIImpactFeedbackStyle style = UIImpactFeedbackStyleLight;
    if ([kind isEqualToString:@"click"]) style = UIImpactFeedbackStyleRigid;
    if ([kind isEqualToString:@"trigger"]) style = UIImpactFeedbackStyleSoft;
    if ([kind isEqualToString:@"success"]) style = UIImpactFeedbackStyleMedium;
    UIImpactFeedbackGenerator *g = [[UIImpactFeedbackGenerator alloc] initWithStyle:style];
    [g impactOccurred];
  });
}

- (void)play:(NSString *)kind {
  dispatch_async(_queue, ^{
    if (![self ensureEngine]) {
      [self fallback:kind];
      return;
    }
    CHHapticPattern *pattern = [self patternFor:kind];
    NSError *error = nil;
    id<CHHapticPatternPlayer> player = pattern ? [self->_engine createPlayerWithPattern:pattern error:&error] : nil;
    if (!player || ![player startAtTime:CHHapticTimeImmediate error:&error]) [self fallback:kind];
  });
}

- (void)rumble:(float)intensity sharpness:(float)sharpness {
  dispatch_async(_queue, ^{
    if (!self.phoneRumbleEnabled && intensity > 0.01f) return;
    if (intensity <= 0.01f) {
      [self->_rumble stopAtTime:CHHapticTimeImmediate error:nil];
      self->_rumble = nil;
      self->_rumbleLevel = 0;
      return;
    }
    if (![self ensureEngine]) return;
    NSError *error = nil;
    if (!self->_rumble) {
      CHHapticEvent *event = [[CHHapticEvent alloc]
          initWithEventType:CHHapticEventTypeHapticContinuous
                 parameters:@[
                   param(CHHapticEventParameterIDHapticIntensity, 1.0),
                   param(CHHapticEventParameterIDHapticSharpness, sharpness),
                 ]
               relativeTime:0
                   duration:30];
      CHHapticPattern *pattern = [[CHHapticPattern alloc] initWithEvents:@[ event ] parameters:@[] error:&error];
      if (!pattern) return;
      id<CHHapticAdvancedPatternPlayer> player = [self->_engine createAdvancedPlayerWithPattern:pattern error:&error];
      if (!player) return;
      player.loopEnabled = YES;
      if (![player startAtTime:CHHapticTimeImmediate error:&error]) return;
      self->_rumble = player;
    }
    if (fabsf(intensity - self->_rumbleLevel) < 0.02f) return;
    self->_rumbleLevel = intensity;
    CHHapticDynamicParameter *level =
        [[CHHapticDynamicParameter alloc] initWithParameterID:CHHapticDynamicParameterIDHapticIntensityControl
                                                        value:intensity
                                                 relativeTime:0];
    [self->_rumble sendParameters:@[ level ] atTime:CHHapticTimeImmediate error:nil];
  });
}

@end
