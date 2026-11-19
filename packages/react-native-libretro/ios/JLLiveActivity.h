#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Live Activity de la partida (Dynamic Island y pantalla de bloqueo). La parte de ActivityKit es
// Swift y vive en el target de la app (ios-overlay/LiveActivity, añadido por
// scripts/add-live-activity.rb); aquí se llama por nombre de clase para no depender de ella.
@interface JLLiveActivity : NSObject

/** true si el iPhone admite Live Activities y el usuario no las desactivó para la app. */
+ (BOOL)available;

/** Empieza la actividad: {title, console, coverPath, accent, startedAt(ms)}. */
+ (void)start:(NSDictionary *)info;

/** Actualiza el estado: {paused, lastSave, startedAt(ms)}. */
+ (void)update:(NSDictionary *)info;

/** Termina todas las actividades de la app. */
+ (void)end;

@end

NS_ASSUME_NONNULL_END
