#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Música ambiental retro de la interfaz, sintetizada en el dispositivo (sin archivos ni licencias):
// pad suave + arpegio chiptune con eco + bajo, en bucle generativo. Categoría Ambient: respeta el
// interruptor de silencio, se mezcla con otras apps y se pausa sola si otra app reproduce audio.
@interface JLAmbientMusic : NSObject

+ (instancetype)shared;

/** Quiere sonar (interfaz visible y opción activada). Se pausa sola con audio externo. */
- (void)setWanted:(BOOL)wanted;

/** Volumen 0..1 (por defecto 0.5). */
- (void)setVolume:(float)volume;

/** JSON {wanted, playing, otherAudio}. */
- (NSString *)status;

@end

NS_ASSUME_NONNULL_END
