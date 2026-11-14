#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Puente con GameController.framework. Mantiene el mando activo (primero conectado) y
// escribe su estado en el host de Libretro desde el handler de valores: la lectura por
// retro_input_state no toca el hilo de JS.
@interface GamepadBridge : NSObject

+ (instancetype)sharedBridge;

/** Empieza a escuchar conexiones. El handler recibe {connected, dualSense, name}. */
- (void)startWithStatusHandler:(void (^)(NSDictionary *status))handler;

- (BOOL)isDualSenseConnected;

/** {connected, dualSense, name, kind (PS5/PS4/Xbox/Mando), rumble} del mando activo. */
- (NSDictionary *)currentStatus;

/** Vibración del mando del jugador `port` (0 = parar). Hilo principal. */
- (void)applyRumble:(float)intensity sharpness:(float)sharpness port:(unsigned)port;

/** Intercambia Jugador 1 y Jugador 2 (LEDs y puertos). */
- (void)swapPlayers;

/** Mapeo físico -> botón libretro (16 entradas en orden UP, DOWN, LEFT, RIGHT, Cruz, Círculo,
 *  Cuadrado, Triángulo, L1, R1, L2, R2, L3, R3, Options, Create; -1 = sin función). */
- (void)setMapping:(NSArray<NSNumber *> *)mapping;

/** Zona muerta de los sticks (0..0.6) y si el stick izquierdo también mueve la cruceta. */
- (void)setDeadzone:(float)deadzoneValue stickToDpad:(BOOL)stickToDpad;

/** {buttons (máscara física), lx, ly} del mando del jugador `port` (pantalla de prueba). */
- (NSDictionary *)physicalState:(int)port;

/** Busca mandos inalámbricos (startWirelessControllerDiscovery). */
- (void)discover;

@end

NS_ASSUME_NONNULL_END
