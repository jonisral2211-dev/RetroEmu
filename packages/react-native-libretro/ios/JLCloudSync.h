#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Sincronización de partidas con una carpeta de iCloud Drive elegida por el usuario (bookmark
// con permiso de seguridad: funciona con la firma gratuita de SideStore, sin contenedor iCloud).
// Copia guardados nativos (.srm/.sav/.mcr…) y save states (+ capturas) en ambos sentidos: gana el
// más reciente. La copia local siempre se conserva para jugar sin conexión.
@interface JLCloudSync : NSObject

/** Elige la carpeta (p. ej. iCloud Drive/JL Emulator). completion(nombre) o (nil, error). */
+ (void)pickFolderWithCompletion:(void (^)(NSString *_Nullable name, NSString *_Nullable error))completion;

/** JSON {linked, name, available, lastSync}. */
+ (NSString *)info;

+ (void)unlink;

/**
 * Sincroniza las partidas de un juego (romPath) o de todos (romPath vacío).
 * direction: 'push' (local -> nube), 'pull' (nube -> local) o 'both'.
 * Devuelve JSON {ok, error, pushed, pulled, pending}. pending = archivos de iCloud aún descargándose.
 */
+ (NSString *)syncGame:(NSString *)romPath docs:(NSString *)docs direction:(NSString *)direction;

@end

NS_ASSUME_NONNULL_END
