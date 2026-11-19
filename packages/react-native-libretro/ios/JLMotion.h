#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Giroscopio para el paralaje 3D de las carátulas: inclinación relativa a la postura al empezar.
@interface JLMotion : NSObject

/** Empieza (o deja de) leer el movimiento del iPhone. Contador de usos: varias pantallas a la vez. */
+ (void)start;
+ (void)stop;

/** "x|y" en [-1, 1] (x = giro lateral, y = cabeceo), suavizado. "0|0" sin giroscopio. */
+ (NSString *)tilt;

@end

NS_ASSUME_NONNULL_END
