#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Escáner y auto-clasificador de una carpeta externa (Descargas, iCloud Drive, En mi iPhone…)
// elegida una sola vez con el selector de Archivos. El permiso se guarda como bookmark de la URL
// con ámbito de seguridad, así la app vuelve a leerla al abrirse o al pulsar Sincronizar.
// Cada archivo se identifica por cabecera, serial y contenido (también dentro de .zip/.7z sin
// extraerlo); las BIOS se reconocen por nombre o MD5 y van a system/.
@interface JLFolderScanner : NSObject

/** Abre el selector de carpetas; completion(nombre) o (nil, error). nil, nil = cancelado. */
+ (void)pickFolderWithCompletion:(void (^)(NSString *_Nullable name, NSString *_Nullable error))completion;

/** Selector de carpetas genérico: guarda el bookmark y el nombre en NSUserDefaults con esas claves. */
+ (void)pickFolderStoringBookmark:(NSString *)bookmarkKey
                             name:(NSString *)nameKey
                       completion:(void (^)(NSString *_Nullable name, NSString *_Nullable error))completion;

/** URL de un bookmark guardado (renovado si estaba caducado); nil si no hay. */
+ (nullable NSURL *)resolveBookmark:(NSString *)bookmarkKey;

/** JSON {linked, name, available}. */
+ (NSString *)linkedInfo;
+ (void)unlink;

/**
 * Analiza la carpeta vinculada sin cambiar nada (bloqueante: llamar fuera del hilo principal).
 * JSON {ok, error, folder, items:[…], summary:{games:{consola:n}, bios, archives, unknown,
 * icloud, already, total}}.
 */
+ (NSString *)analyze:(NSString *)docs;

/**
 * Importa a Documents todo lo reconocido que no se importó antes (bloqueante). move = borra el
 * original tras copiarlo bien. JSON {ok, error, imported:{consola:n}, bios, archives, failed,
 * skipped, errors:[…]}.
 */
+ (NSString *)importInto:(NSString *)docs move:(BOOL)move;

/** Progreso de analyze/import: JSON {busy, phase, current, done, total}. */
+ (NSString *)status;

/**
 * Si el archivo es una BIOS conocida (por nombre o por MD5 de las versiones buenas), devuelve su
 * ruta de destino en system/ (con el nombre que esperan los núcleos); si no, nil.
 */
+ (nullable NSString *)biosTargetFor:(NSString *)path docs:(NSString *)docs;

/** Identificación de un juego ya importado: JSON {console, serial, title}. */
+ (NSString *)romInfo:(NSString *)path;

@end

NS_ASSUME_NONNULL_END
