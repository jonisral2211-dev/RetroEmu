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

@end

NS_ASSUME_NONNULL_END
