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

/** Vibración del mando activo (0 = parar). Hilo principal. */
- (void)applyRumble:(float)intensity sharpness:(float)sharpness;

@end

NS_ASSUME_NONNULL_END
