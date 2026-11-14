#import "GamepadBridge.h"

#import <CoreHaptics/CoreHaptics.h>
#import <GameController/GameController.h>

#include <cmath>

#include "LibretroHost.hpp"
#include "libretro.h"

#define PAD_BIT(id) (uint16_t)(1u << (id))

static const NSUInteger kMaxPlayers = 2;

@interface GamepadBridge ()
// Mandos por jugador: [0] = Jugador 1 (puerto 0), [1] = Jugador 2 (puerto 1)
@property (nonatomic, strong) NSMutableArray<GCController *> *players;
@property (nonatomic, copy, nullable) void (^statusHandler)(NSDictionary *status);
// Vibración por jugador: motor háptico continuo con intensidad variable
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, CHHapticEngine *> *engines;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, id<CHHapticAdvancedPatternPlayer>> *rumblePlayers;
@end

// El core pide vibración desde el hilo de emulación: se aplica en el hilo principal
static void onCoreRumble(unsigned port, float strong, float weak) {
  const float intensity = fmaxf(strong, weak * 0.6f);
  const float sharpness = strong >= weak ? 0.3f : 0.8f;
  dispatch_async(dispatch_get_main_queue(), ^{
    [[GamepadBridge sharedBridge] applyRumble:intensity sharpness:sharpness port:port];
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

- (instancetype)init {
  if (self = [super init]) {
    _players = [NSMutableArray array];
    _engines = [NSMutableDictionary dictionary];
    _rumblePlayers = [NSMutableDictionary dictionary];
  }
  return self;
}

- (void)startWithStatusHandler:(void (^)(NSDictionary *status))handler {
  self.statusHandler = handler;
  host::setRumbleHandler(onCoreRumble);
  NSNotificationCenter *nc = NSNotificationCenter.defaultCenter;
  [nc addObserver:self selector:@selector(controllerConnected:) name:GCControllerDidConnectNotification object:nil];
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
  for (GCController *c in self.players) {
    if ([self isDualSense:c]) return YES;
  }
  return NO;
}

#pragma mark - Conexión

- (void)controllerConnected:(NSNotification *)note {
  [self adopt:note.object];
  [self publish];
}

- (void)controllerDisconnected:(NSNotification *)note {
  GCController *gone = note.object;
  if ([self.players containsObject:gone]) {
    [self.players removeObject:gone];
    // Otro mando conectado pero sin puesto ocupa el hueco
    for (GCController *other in GCController.controllers) {
      if (self.players.count >= kMaxPlayers) break;
      if (other != gone && other.extendedGamepad && ![self.players containsObject:other]) {
        [self.players addObject:other];
        [self listen:other];
      }
    }
    [self refreshPorts];
  }
  [self publish];
}

- (void)adopt:(GCController *)controller {
  if (!controller || !controller.extendedGamepad) return;
  if ([self.players containsObject:controller] || self.players.count >= kMaxPlayers) return;
  [self.players addObject:controller];
  [self listen:controller];
  [self refreshPorts];
}

- (void)listen:(GCController *)controller {
  __weak GamepadBridge *weakSelf = self;
  __weak GCController *weakController = controller;
  controller.extendedGamepad.valueChangedHandler = ^(GCExtendedGamepad *pad, GCControllerElement *element) {
    GamepadBridge *strongSelf = weakSelf;
    GCController *c = weakController;
    if (!strongSelf || !c) return;
    const NSUInteger port = [strongSelf.players indexOfObject:c];
    if (port != NSNotFound) [strongSelf sample:pad port:(int)port];
  };
}

// Tras conectar, desconectar o intercambiar: índice de jugador (LED), color de la barra de luz
// y estado de cada puerto desde cero
- (void)refreshPorts {
  [self stopAllRumble];
  for (int port = 0; port < (int)kMaxPlayers; ++port) {
    if (port < (int)self.players.count) {
      GCController *c = self.players[port];
      c.playerIndex = port == 0 ? GCControllerPlayerIndex1 : GCControllerPlayerIndex2;
      if (@available(iOS 14.0, *)) {
        // J1 azul, J2 rojo (barra de luz de DualSense / DualShock 4)
        c.light.color = port == 0 ? [[GCColor alloc] initWithRed:0.1 green:0.35 blue:1.0]
                                  : [[GCColor alloc] initWithRed:1.0 green:0.15 blue:0.15];
      }
      [self sample:c.extendedGamepad port:port];
    } else {
      host::setGamepadPort(port, 0, 0, 0, 0, 0, 0, 0);
    }
  }
}

- (void)swapPlayers {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.players.count < 2) return;
    [self.players exchangeObjectAtIndex:0 withObjectAtIndex:1];
    [self refreshPorts];
    [self publish];
  });
}

#pragma mark - Lectura

// Mapeo del perfil GCExtendedGamepad (DualSense, DualShock 4, Xbox) a RETRO_DEVICE_ID_JOYPAD_*:
//   Cruz (buttonA) -> B,  Círculo (buttonB) -> A,  Cuadrado (buttonX) -> Y,  Triángulo (buttonY) -> X
//   Options (buttonMenu) -> START,  Create (buttonOptions) -> SELECT
//   L1/R1 -> L/R,  L2/R2 -> L2/R2 (también analógicos),  clics de stick -> L3/R3
- (void)sample:(GCExtendedGamepad *)pad port:(int)port {
  if (!pad) return;
  uint16_t buttons = 0;
  if (pad.buttonA.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_B);
  if (pad.buttonB.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_A);
  if (pad.buttonX.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_Y);
  if (pad.buttonY.pressed) buttons |= PAD_BIT(RETRO_DEVICE_ID_JOYPAD_X);

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

  // Sticks: GameController tiene +Y arriba; libretro usa negativo = arriba
  auto dz = [](float v) { return fabsf(v) < 0.1f ? 0.0f : v; };
  const float lx = dz(pad.leftThumbstick.xAxis.value);
  const float ly = dz(-pad.leftThumbstick.yAxis.value);
  const float rx = dz(pad.rightThumbstick.xAxis.value);
  const float ry = dz(-pad.rightThumbstick.yAxis.value);
  host::setGamepadPort(port, buttons, lx, ly, rx, ry, pad.leftTrigger.value, pad.rightTrigger.value);
}

#pragma mark - Vibración

- (void)stopAllRumble {
  for (id<CHHapticAdvancedPatternPlayer> p in self.rumblePlayers.allValues) [p stopAtTime:0 error:nil];
  for (CHHapticEngine *e in self.engines.allValues) [e stopWithCompletionHandler:nil];
  [self.rumblePlayers removeAllObjects];
  [self.engines removeAllObjects];
}

- (void)applyRumble:(float)intensity sharpness:(float)sharpness port:(unsigned)port {
  if (port >= self.players.count) return;
  GCController *c = self.players[port];
  if (@available(iOS 14.0, *)) {
    if (!c.haptics) return;  // mandos sin motores de vibración
    NSNumber *key = @(port);
    NSError *error = nil;
    id<CHHapticAdvancedPatternPlayer> player = self.rumblePlayers[key];
    if (intensity <= 0.01f) {
      [player stopAtTime:0 error:nil];
      [self.rumblePlayers removeObjectForKey:key];
      return;
    }
    CHHapticEngine *engine = self.engines[key];
    if (!engine) {
      engine = [c.haptics createEngineWithLocality:GCHapticsLocalityDefault];
      engine.playsHapticsOnly = YES;
      if (!engine || ![engine startAndReturnError:&error]) return;
      self.engines[key] = engine;
    }
    if (!player) {
      // Evento continuo largo en bucle; la intensidad se ajusta con parámetros dinámicos
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
      player = [engine createAdvancedPlayerWithPattern:pattern error:&error];
      if (!player) return;
      player.loopEnabled = YES;
      [player startAtTime:0 error:&error];
      self.rumblePlayers[key] = player;
    }
    CHHapticDynamicParameter *level =
        [[CHHapticDynamicParameter alloc] initWithParameterID:CHHapticDynamicParameterIDHapticIntensityControl
                                                        value:intensity
                                                 relativeTime:0];
    [player sendParameters:@[ level ] atTime:0 error:nil];
  }
}

#pragma mark - Estado

- (BOOL)isDualSense:(GCController *)controller {
  return controller && [controller.productCategory isEqualToString:GCProductCategoryDualSense];
}

- (NSString *)kindOf:(GCController *)c {
  NSString *category = c.productCategory ?: @"";
  if ([category isEqualToString:GCProductCategoryDualSense]) return @"PS5";
  if ([category isEqualToString:GCProductCategoryDualShock4]) return @"PS4";
  if ([category containsString:@"Xbox"]) return @"Xbox";
  return @"Mando";
}

- (NSDictionary *)currentStatus {
  GCController *c = self.players.firstObject;
  NSMutableArray<NSDictionary *> *list = [NSMutableArray array];
  BOOL rumble = NO;
  for (GCController *p in self.players) {
    BOOL hasHaptics = NO;
    if (@available(iOS 14.0, *)) hasHaptics = p.haptics != nil;
    rumble = rumble || hasHaptics;
    [list addObject:@{@"name" : p.vendorName ?: @"", @"kind" : [self kindOf:p], @"rumble" : @(hasHaptics)}];
  }
  return @{
    @"connected" : @(c != nil),
    @"dualSense" : @([self isDualSenseConnected]),
    @"name" : c.vendorName ?: @"",
    @"kind" : c ? [self kindOf:c] : @"",
    @"rumble" : @(rumble),
    @"count" : @(self.players.count),
    @"players" : list,
  };
}

- (void)publish {
  if (self.statusHandler) self.statusHandler([self currentStatus]);
}

@end
