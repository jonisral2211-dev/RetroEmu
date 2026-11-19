#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Logros retro (RetroAchievements) con rcheevos: hash compatible con RA y evaluación de las
// condiciones de cada logro sobre la memoria del núcleo, frame a frame, en el hilo de emulación.
@interface JLAchievements : NSObject

/** Hash RA del juego (MD5 según las reglas de cada consola). '' si no se puede calcular. Lento. */
+ (NSString *)hashForPath:(NSString *)path console:(int)consoleId error:(NSString *_Nullable *_Nullable)error;

/** Activa los logros [{id, memaddr}] del juego en curso (consoleId de RA). */
+ (BOOL)activate:(NSArray<NSDictionary *> *)achievements console:(int)consoleId;

/** Desactiva todo (al salir del juego). */
+ (void)reset;

/** Eventos desde la última consulta: JSON [{id, type: 'unlock'|'progress', value, target}]. */
+ (NSString *)poll;

@end

NS_ASSUME_NONNULL_END
