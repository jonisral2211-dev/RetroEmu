#import "JLMotion.h"

#import <CoreMotion/CoreMotion.h>

static CMMotionManager *g_motion;
static CMAttitude *g_reference;
static NSInteger g_users = 0;
static double g_x = 0, g_y = 0;

@implementation JLMotion

+ (void)start {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!g_motion) g_motion = [CMMotionManager new];
    if (!g_motion.deviceMotionAvailable) return;
    if (g_users++ > 0) return;
    g_reference = nil;
    g_motion.deviceMotionUpdateInterval = 1.0 / 30.0;
    [g_motion startDeviceMotionUpdates];
  });
}

+ (void)stop {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (g_users == 0) return;
    if (--g_users > 0) return;
    [g_motion stopDeviceMotionUpdates];
    g_reference = nil;
    g_x = g_y = 0;
  });
}

+ (NSString *)tilt {
  CMDeviceMotion *m = g_motion.deviceMotion;
  if (!m) return @"0|0";
  CMAttitude *attitude = [m.attitude copy];  // copia: multiplyByInverse modifica el objeto
  if (!g_reference) g_reference = [attitude copy];
  [attitude multiplyByInverseOfAttitude:g_reference];
  // ±0.45 rad (~26°) = tope; la referencia sigue lentamente al usuario si cambia de postura
  const double x = fmax(-1.0, fmin(1.0, attitude.roll / 0.45));
  const double y = fmax(-1.0, fmin(1.0, attitude.pitch / 0.45));
  g_x += (x - g_x) * 0.35;
  g_y += (y - g_y) * 0.35;
  if (fabs(x) > 0.98 || fabs(y) > 0.98) g_reference = [m.attitude copy];
  return [NSString stringWithFormat:@"%.3f|%.3f", g_x, g_y];
}

@end
