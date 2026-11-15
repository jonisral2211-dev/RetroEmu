#import "GamepadBridge.h"

#import <CoreHaptics/CoreHaptics.h>
#import <GameController/GameController.h>

#include <cmath>

#include "LibretroHost.hpp"
#include "libretro.h"

#define PAD_BIT(id) (uint16_t)(1u << (id))

static const NSUInteger kMaxPlayers = 4;

// Controles físicos (orden fijo, el mismo que usa la pantalla de mapeo en JS)
enum Phys : int {
  kUp, kDown, kLeft, kRight, kCross, kCircle, kSquare, kTriangle,
  kL1, kR1, kL2, kR2, kL3, kR3, kMenu, kOptions, kPhysCount
};
// Mapeo físico -> RETRO_DEVICE_ID_JOYPAD_* (255 = sin función). Por defecto: Cruz=B, Círculo=A,
// Cuadrado=Y, Triángulo=X, Options=START, Create=SELECT (convención libretro / PlayStation).
static uint8_t g_map[kPhysCount] = {
  RETRO_DEVICE_ID_JOYPAD_UP, RETRO_DEVICE_ID_JOYPAD_DOWN, RETRO_DEVICE_ID_JOYPAD_LEFT, RETRO_DEVICE_ID_JOYPAD_RIGHT,
  RETRO_DEVICE_ID_JOYPAD_B, RETRO_DEVICE_ID_JOYPAD_A, RETRO_DEVICE_ID_JOYPAD_Y, RETRO_DEVICE_ID_JOYPAD_X,
  RETRO_DEVICE_ID_JOYPAD_L, RETRO_DEVICE_ID_JOYPAD_R, RETRO_DEVICE_ID_JOYPAD_L2, RETRO_DEVICE_ID_JOYPAD_R2,
  RETRO_DEVICE_ID_JOYPAD_L3, RETRO_DEVICE_ID_JOYPAD_R3, RETRO_DEVICE_ID_JOYPAD_START, RETRO_DEVICE_ID_JOYPAD_SELECT,
};
static float g_deadzone = 0.15f;      // zona muerta de los sticks
static bool g_stickToDpad = true;     // el stick izquierdo también mueve la cruceta (arcade, GBA…)
static uint32_t g_physMask[2] = {0, 0};  // controles físicos pulsados ahora (pantalla de prueba)
static float g_physAxes[2][2] = {{0, 0}, {0, 0}};

@interface GamepadBridge ()
// Mandos por jugador: [0] = Jugador 1 (puerto 0) … [3] = Jugador 4 (puerto 3)
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
      if (other != gone && (other.extendedGamepad || other.microGamepad) && ![self.players containsObject:other]) {
        [self.players addObject:other];
        [self listen:other];
      }
    }
    [self refreshPorts];
  }
  [self publish];
}

- (void)adopt:(GCController *)controller {
  if (!controller || (!controller.extendedGamepad && !controller.microGamepad)) return;
  if ([self.players containsObject:controller] || self.players.count >= kMaxPlayers) return;
  [self.players addObject:controller];
  [self listen:controller];
  [self refreshPorts];
}

- (void)listen:(GCController *)controller {
  __weak GamepadBridge *weakSelf = self;
  __weak GCController *weakController = controller;
  void (^handler)(void) = ^{
    GamepadBridge *strongSelf = weakSelf;
    GCController *c = weakController;
    if (!strongSelf || !c) return;
    const NSUInteger port = [strongSelf.players indexOfObject:c];
    if (port != NSNotFound) [strongSelf sampleController:c port:(int)port];
  };
  if (controller.extendedGamepad) {
    controller.extendedGamepad.valueChangedHandler = ^(GCExtendedGamepad *pad, GCControllerElement *element) { handler(); };
  } else if (controller.microGamepad) {
    controller.microGamepad.valueChangedHandler = ^(GCMicroGamepad *pad, GCControllerElement *element) { handler(); };
  }
}

- (void)sampleController:(GCController *)c port:(int)port {
  if (c.extendedGamepad) {
    [self sample:c.extendedGamepad port:port];
  } else if (c.microGamepad) {
    [self sampleMicro:c.microGamepad port:port];
  }
}

// Bits libretro a partir de los controles físicos pulsados, con el mapeo del usuario
static uint16_t mapPhysical(uint32_t phys) {
  uint16_t bits = 0;
  for (int i = 0; i < kPhysCount; ++i) {
    if ((phys >> i) & 1u) {
      if (g_map[i] < 16) bits |= PAD_BIT(g_map[i]);
    }
  }
  return bits;
}

static float deadzone(float v) {
  const float a = fabsf(v);
  if (a < g_deadzone) return 0.0f;
  return copysignf((a - g_deadzone) / (1.0f - g_deadzone), v);  // sin salto al salir de la zona
}

// Stick -> cruceta (8 direcciones) para consolas y recreativas sin analógico
static uint32_t stickAsDpad(float x, float y) {
  uint32_t phys = 0;
  if (x < -0.5f) phys |= 1u << kLeft;
  if (x > 0.5f) phys |= 1u << kRight;
  if (y < -0.5f) phys |= 1u << kUp;
  if (y > 0.5f) phys |= 1u << kDown;
  return phys;
}

// Mandos simples (GCMicroGamepad: algunos mandos/palancas básicos): cruceta, A, X y Menú
- (void)sampleMicro:(GCMicroGamepad *)pad port:(int)port {
  uint32_t phys = 0;
  if (pad.dpad.up.pressed) phys |= 1u << kUp;
  if (pad.dpad.down.pressed) phys |= 1u << kDown;
  if (pad.dpad.left.pressed) phys |= 1u << kLeft;
  if (pad.dpad.right.pressed) phys |= 1u << kRight;
  if (pad.buttonA.pressed) phys |= 1u << kCross;
  if (pad.buttonX.pressed) phys |= 1u << kSquare;
  if (@available(iOS 13.0, *)) {
    if (pad.buttonMenu.pressed) phys |= 1u << kMenu;
  }
  if (port < 2) {
    g_physMask[port] = phys;
    g_physAxes[port][0] = 0;
    g_physAxes[port][1] = 0;
  }
  host::setGamepadPort(port, mapPhysical(phys), 0, 0, 0, 0, 0, 0);
}

// Tras conectar, desconectar o intercambiar: índice de jugador (LED), color de la barra de luz
// y estado de cada puerto desde cero
- (void)refreshPorts {
  [self stopAllRumble];
  for (int port = 0; port < (int)kMaxPlayers; ++port) {
    if (port < (int)self.players.count) {
      GCController *c = self.players[port];
      static const GCControllerPlayerIndex kIndex[4] = {GCControllerPlayerIndex1, GCControllerPlayerIndex2,
                                                         GCControllerPlayerIndex3, GCControllerPlayerIndex4};
      c.playerIndex = kIndex[port];
      if (@available(iOS 14.0, *)) {
        // Barra de luz: J1 azul, J2 rojo, J3 verde, J4 naranja (DualSense / DualShock 4)
        static const float kRGB[4][3] = {{0.1f, 0.35f, 1.0f}, {1.0f, 0.15f, 0.15f}, {0.1f, 0.85f, 0.3f}, {1.0f, 0.55f, 0.0f}};
        c.light.color = [[GCColor alloc] initWithRed:kRGB[port][0] green:kRGB[port][1] blue:kRGB[port][2]];
      }
      [self sampleController:c port:port];
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
  uint32_t phys = 0;
  if (pad.dpad.up.pressed) phys |= 1u << kUp;
  if (pad.dpad.down.pressed) phys |= 1u << kDown;
  if (pad.dpad.left.pressed) phys |= 1u << kLeft;
  if (pad.dpad.right.pressed) phys |= 1u << kRight;
  if (pad.buttonA.pressed) phys |= 1u << kCross;
  if (pad.buttonB.pressed) phys |= 1u << kCircle;
  if (pad.buttonX.pressed) phys |= 1u << kSquare;
  if (pad.buttonY.pressed) phys |= 1u << kTriangle;
  if (pad.leftShoulder.pressed) phys |= 1u << kL1;
  if (pad.rightShoulder.pressed) phys |= 1u << kR1;
  if (pad.leftTrigger.value > 0.3f) phys |= 1u << kL2;
  if (pad.rightTrigger.value > 0.3f) phys |= 1u << kR2;
  if (pad.leftThumbstickButton.pressed) phys |= 1u << kL3;
  if (pad.rightThumbstickButton.pressed) phys |= 1u << kR3;
  if (pad.buttonMenu.pressed) phys |= 1u << kMenu;
  if (pad.buttonOptions.pressed) phys |= 1u << kOptions;

  // Sticks: GameController tiene +Y arriba; libretro usa negativo = arriba
  const float lx = deadzone(pad.leftThumbstick.xAxis.value);
  const float ly = deadzone(-pad.leftThumbstick.yAxis.value);
  const float rx = deadzone(pad.rightThumbstick.xAxis.value);
  const float ry = deadzone(-pad.rightThumbstick.yAxis.value);
  if (port < 2) {
    g_physMask[port] = phys;
    g_physAxes[port][0] = lx;
    g_physAxes[port][1] = ly;
  }
  if (g_stickToDpad) phys |= stickAsDpad(lx, ly);
  host::setGamepadPort(port, mapPhysical(phys), lx, ly, rx, ry, pad.leftTrigger.value, pad.rightTrigger.value);
}

#pragma mark - Mapeo y búsqueda

- (void)setMapping:(NSArray<NSNumber *> *)mapping {
  for (NSUInteger i = 0; i < kPhysCount && i < mapping.count; ++i) {
    const int v = mapping[i].intValue;
    g_map[i] = (v >= 0 && v < 16) ? uint8_t(v) : 255;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    [self refreshPorts];
  });
}

- (void)setDeadzone:(float)deadzoneValue stickToDpad:(BOOL)stickToDpad {
  g_deadzone = fminf(0.6f, fmaxf(0.02f, deadzoneValue));
  g_stickToDpad = stickToDpad;
}

- (NSDictionary *)physicalState:(int)port {
  if (port < 0 || port > 1) return @{};
  return @{@"buttons" : @(g_physMask[port]), @"lx" : @(g_physAxes[port][0]), @"ly" : @(g_physAxes[port][1])};
}

- (void)discover {
  dispatch_async(dispatch_get_main_queue(), ^{
    // Busca mandos MFi inalámbricos en modo emparejamiento; los Bluetooth (DualSense, Xbox,
    // palancas) se emparejan en Ajustes > Bluetooth y aparecen solos al conectarse
    [GCController startWirelessControllerDiscoveryWithCompletionHandler:^{
      for (GCController *c in GCController.controllers) [self adopt:c];
      [self publish];
    }];
    for (GCController *c in GCController.controllers) [self adopt:c];
    [self publish];
  });
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
  if (!c.extendedGamepad && c.microGamepad) return @"Mando simple";
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
