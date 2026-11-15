#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Herramientas de la biblioteca: subida por Wi-Fi, códigos QR, respaldo de partidas y BIOS
@interface JLTools : NSObject

// ---- Subir por Wi-Fi: servidor HTTP en la red local (página de arrastrar y soltar) ----
/** Arranca el servidor en `port`; cada archivo recibido se entrega a `onFile` (ruta en Documents). */
+ (BOOL)startUploadServerOnPort:(int)port onFile:(void (^)(NSString *path))onFile;
+ (void)stopUploadServer;
/** JSON {running, port, files, bytes, current, progress, last, error}. */
+ (NSString *)uploadStatus;

/** Código QR nítido (PNG) de `text` en `path`. */
+ (BOOL)writeQRCode:(NSString *)text toPath:(NSString *)path;

// ---- Respaldo de partidas ----
/** Crea Documents/Backups/JL-respaldo-<fecha>.zip con saves/ y states/. Devuelve la ruta o nil. */
+ (nullable NSString *)exportBackup:(NSString *)docs error:(NSString *_Nullable *_Nullable)error;
/** Restaura saves/ y states/ desde un .zip de respaldo (sobrescribe). Devuelve el número de archivos. */
+ (NSInteger)restoreBackup:(NSString *)zipPath docs:(NSString *)docs error:(NSString *_Nullable *_Nullable)error;

/** Estado de las BIOS conocidas: JSON [{console, file, found, md5ok, required, note}]. */
+ (NSString *)biosStatus:(NSString *)docs;

@end

NS_ASSUME_NONNULL_END
