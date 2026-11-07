#import "GamepadBridge.h"

#import <GameController/GameController.h>

#include <cmath>

#include "LibretroHost.hpp"
#include "libretro.h"

#define PAD_BIT(id) (uint16_t)(1u << (id))

@interface GamepadBridge ()
@property (nonatomic, strong, nullable) GCController *active;
@property (nonatomic, copy, nullable) void (^statusHandler)(NSDictionary *status);
@end

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
  }
  [self publish];
}

- (void)adopt:(GCController *)controller {
  if (!controller || !controller.extendedGamepad) return;
  if (self.active && self.active != controller) return;  // un mando activo a la vez

  self.active = controller;
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
}

#pragma mark - Estado

- (BOOL)isDualSense:(GCController *)controller {
  return controller && [controller.productCategory isEqualToString:GCProductCategoryDualSense];
}

- (NSDictionary *)currentStatus {
  GCController *c = self.active;
  return @{
    @"connected" : @(c != nil),
    @"dualSense" : @([self isDualSense:c]),
    @"name" : c.vendorName ?: @"",
  };
}

- (void)publish {
  if (self.statusHandler) self.statusHandler([self currentStatus]);
}

@end
