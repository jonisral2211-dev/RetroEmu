#import "GamepadBridge.h"

#import <CoreHaptics/CoreHaptics.h>
#import <GameController/GameController.h>

#include <cmath>

#include "LibretroHost.hpp"
#include "libretro.h"

#define PAD_BIT(id) (uint16_t)(1u << (id))

@interface GamepadBridge ()
@property (nonatomic, strong, nullable) GCController *active;
@property (nonatomic, copy, nullable) void (^statusHandler)(NSDictionary *status);
// Vibración del mando (DualSense/DualShock/Xbox): motor háptico continuo con intensidad variable
@property (nonatomic, strong, nullable) CHHapticEngine *rumbleEngine;
@property (nonatomic, strong, nullable) id<CHHapticAdvancedPatternPlayer> rumblePlayer;
@end

// El core pide vibración desde el hilo de emulación: se aplica en el hilo principal
static void onCoreRumble(float strong, float weak) {
  const float intensity = fmaxf(strong, weak * 0.6f);
  dispatch_async(dispatch_get_main_queue(), ^{
    [[GamepadBridge sharedBridge] applyRumble:intensity sharpness:strong >= weak ? 0.3f : 0.8f];
  });
}

@implementation GamepadBridge

+ (instancetype)sharedBridge {
  static GamepadBridge *shared;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    shared = [GamepadBridge new];
  });
  return shared;
}

- (void)startWithStatusHandler:(void (^)(NSDictionary *status))handler {
  self.statusHandler = handler;
  host::setRumbleHandler(onCoreRumble);
  NSNotificationCenter *nc = NSNotificationCenter.defaultCenter;
  [nc addObserver:self
         selector:@selector(controllerConnected:)
             name:GCControllerDidConnectNotification
           object:nil];
  [nc addObserver:self
         selector:@selector(controllerDisconnected:)
             name:GCControllerDidDisconnectNotification
           object:nil];
  for (GCController *controller in GCController.controllers) {
    [self adopt:controller];
  }
  [self publish];
}

- (BOOL)isDualSenseConnected {
  return [self isDualSense:self.active];
}

#pragma mark - Conexión

- (void)controllerConnected:(NSNotification *)note {
  [self adopt:note.object];
  [self publish];
}

- (void)controllerDisconnected:(NSNotification *)note {
  GCController *gone = note.object;
  if (gone == self.active) {
    self.active = nil;
    // Pasamos al siguiente mando extendido que siga conectado, si lo hay
    for (GCController *other in GCController.controllers) {
      if (other != gone && other.extendedGamepad) {
        [self adopt:other];
        break;
      }
    }
  }
  if (!self.active) {
    host::setGamepad(0, 0, 0);
    host::setGamepadExtra(0, 0, 0, 0);
    [self stopRumbleEngine];
  }
  [self publish];
}

- (void)adopt:(GCController *)controller {
  if (!controller || !controller.extendedGamepad) return;
  if (self.active && self.active != controller) return;  // un mando activo a la vez

  self.active = controller;
  [self stopRumbleEngine];
  __weak GamepadBridge *weakSelf = self;
  controller.extendedGamepad.valueChangedHandler =
      ^(GCExtendedGamepad *pad, GCControllerElement *element) {
        [weakSelf sample:pad];
      };
  [self sample:controller.extendedGamepad];
}

#pragma mark - Lectura

// Mapeo del DualSense (perfil GCExtendedGamepad) a RETRO_DEVICE_ID_JOYPAD_*:
//   Cruz (buttonA) -> B,  Círculo (buttonB) -> A,  Cuadrado (buttonX) -> X,  Triángulo (buttonY) -> Y
//   Options (buttonMenu) -> START,  Share/Create (buttonOptions) -> SELECT
//   L1/R1 -> L/R,  L2/R2 -> L2/R2 (gatillo Z en N64),  clics de stick -> L3/R3
//   D-Pad -> D-Pad,  leftThumbstick -> stick analógico izquierdo
- (void)sample:(GCExtendedGamepad *)pad {
  uint16_t buttons = 0;
  if (pad.buttonA.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_B);
  if (pad.buttonB.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_A);
  if (pad.buttonX.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_X);
  if (pad.buttonY.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_Y);

  if (pad.buttonMenu.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_START);
  if (pad.buttonOptions.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_SELECT);

  if (pad.leftShoulder.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_L);
  if (pad.rightShoulder.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_R);
  if (pad.leftTrigger.value > 0.3f) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_L2);
  if (pad.rightTrigger.value > 0.3f) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_R2);
  if (pad.leftThumbstickButton.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_L3);
  if (pad.rightThumbstickButton.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_R3);

  if (pad.dpad.up.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_UP);
  if (pad.dpad.down.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_DOWN);
  if (pad.dpad.left.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_LEFT);
  if (pad.dpad.right.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_RIGHT);

  // Stick: GameController tiene +Y arriba; libretro usa negativo = arriba
  float lx = pad.leftThumbstick.xAxis.value;
  float ly = -pad.leftThumbstick.yAxis.value;
  if (fabsf(lx) < 0.1f) lx = 0;
  if (fabsf(ly) < 0.1f) ly = 0;

  host::setGamepad(buttons, lx, ly);

  // Stick derecho (cámara en N64/PSP con mapeo dual) y gatillos analógicos
  float rx = pad.rightThumbstick.xAxis.value;
  float ry = -pad.rightThumbstick.yAxis.value;
  if (fabsf(rx) < 0.1f) rx = 0;
  if (fabsf(ry) < 0.1f) ry = 0;
  host::setGamepadExtra(rx, ry, pad.leftTrigger.value, pad.rightTrigger.value);
}

#pragma mark - Vibración

- (void)stopRumbleEngine {
  [self.rumblePlayer stopAtTime:0 error:nil];
  [self.rumbleEngine stopWithCompletionHandler:nil];
  self.rumblePlayer = nil;
  self.rumbleEngine = nil;
}

- (void)applyRumble:(float)intensity sharpness:(float)sharpness {
  GCController *c = self.active;
  if (!c) return;
  if (@available(iOS 14.0, *)) {
    if (!c.haptics) return;  // mandos sin motores de vibración
    NSError *error = nil;
    if (intensity <= 0.01f) {
      [self.rumblePlayer stopAtTime:0 error:nil];
      self.rumblePlayer = nil;
      return;
    }
    if (!self.rumbleEngine) {
      self.rumbleEngine = [c.haptics createEngineWithLocality:GCHapticsLocalityDefault];
      self.rumbleEngine.playsHapticsOnly = YES;
      [self.rumbleEngine startAndReturnError:&error];
      if (error) {
        self.rumbleEngine = nil;
        return;
      }
    }
    if (!self.rumblePlayer) {
      // Evento continuo largo; la intensidad se ajusta con parámetros dinámicos
      CHHapticEvent *event = [[CHHapticEvent alloc]
          initWithEventType:CHHapticEventTypeHapticContinuous
                 parameters:@[
                   [[CHHapticEventParameter alloc] initWithParameterID:CHHapticEventParameterIDHapticIntensity value:1.0],
                   [[CHHapticEventParameter alloc] initWithParameterID:CHHapticEventParameterIDHapticSharpness value:sharpness],
                 ]
               relativeTime:0
                   duration:30];
      CHHapticPattern *pattern = [[CHHapticPattern alloc] initWithEvents:@[ event ] parameters:@[] error:&error];
      if (!pattern) return;
      self.rumblePlayer = [self.rumbleEngine createAdvancedPlayerWithPattern:pattern error:&error];
      self.rumblePlayer.loopEnabled = YES;
      [self.rumblePlayer startAtTime:0 error:&error];
    }
    CHHapticDynamicParameter *level =
        [[CHHapticDynamicParameter alloc] initWithParameterID:CHHapticDynamicParameterIDHapticIntensityControl
                                                        value:intensity
                                                 relativeTime:0];
    [self.rumblePlayer sendParameters:@[ level ] atTime:0 error:nil];
  }
}

#pragma mark - Estado

- (BOOL)isDualSense:(GCController *)controller {
  return controller && [controller.productCategory isEqualToString:GCProductCategoryDualSense];
}

- (NSDictionary *)currentStatus {
  GCController *c = self.active;
  NSString *kind = @"";
  if (c) {
    NSString *category = c.productCategory ?: @"";
    if ([category isEqualToString:GCProductCategoryDualSense]) kind = @"PS5";
    else if ([category isEqualToString:GCProductCategoryDualShock4]) kind = @"PS4";
    else if ([category containsString:@"Xbox"]) kind = @"Xbox";
    else kind = @"Mando";
  }
  BOOL rumble = NO;
  if (@available(iOS 14.0, *)) rumble = c.haptics != nil;
  return @{
    @"connected" : @(c != nil),
    @"dualSense" : @([self isDualSense:c]),
    @"name" : c.vendorName ?: @"",
    @"kind" : kind,
    @"rumble" : @(rumble),
  };
}

- (void)publish {
  if (self.statusHandler) self.statusHandler([self currentStatus]);
}

@end
