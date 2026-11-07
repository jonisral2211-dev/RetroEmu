#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

#import "GamepadBridge.h"
#import <ReactCommon/RCTTurboModule.h>
#import <RNLibretroSpec/RNLibretroSpec.h>

#include <memory>

#include <cstring>
#include <map>

#include "LibretroHost.hpp"
#include "RomArchive.hpp"
#include "RomInspector.hpp"

static NSString *documentsDirectory(void) {
  return NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
}

// Carpetas por consola dentro de Documents
static NSArray<NSString *> *consoleFolders(void) {
  return @[ @"gba", @"n64", @"sega", @"mame" ];
}

// Crea las subcarpetas por consola (idempotente)
static void createConsoleFolders(NSString *docs) {
  NSFileManager *fm = NSFileManager.defaultManager;
  for (NSString *folder in consoleFolders()) {
    [fm createDirectoryAtPath:[docs stringByAppendingPathComponent:folder]
        withIntermediateDirectories:YES
                         attributes:nil
                              error:nil];
  }
}

// Limpia la ruta que llega desde JS: quita 'file://' y decodifica %20 si el original no existe
static NSString *normalizeRomPath(NSString *raw) {
  NSString *path = [raw stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if ([path hasPrefix:@"file://"]) {
    path = [path substringFromIndex:@"file://".length];
  }
  if (![NSFileManager.defaultManager fileExistsAtPath:path]) {
    NSString *decoded = [path stringByRemovingPercentEncoding];
    if (decoded) path = decoded;
  }
  return path;
}

// Carpetas de consola dentro de Documents (destino de los zips extraídos)
static romzip::Folders romFolders(NSString *docs) {
  romzip::Folders f;
  f.gba = [docs stringByAppendingPathComponent:@"gba"].UTF8String;
  f.n64 = [docs stringByAppendingPathComponent:@"n64"].UTF8String;
  f.sega = [docs stringByAppendingPathComponent:@"sega"].UTF8String;
  return f;
}

// Consola de un tipo de ROM verificado por contenido (nil = no verificada)
static NSString *consoleForKind(romcheck::Kind kind) {
  switch (kind) {
    case romcheck::Kind::GBA: return @"gba";
    case romcheck::Kind::N64: return @"n64";
    case romcheck::Kind::Sega: return @"sega";
    default: return nil;
  }
}

// Lee solo la cabecera del archivo y la inspecciona según su extensión
static romcheck::Kind sniffFile(NSString *path) {
  NSFileHandle *handle = [NSFileHandle fileHandleForReadingAtPath:path];
  if (!handle) return romcheck::Kind::Unknown;
  NSData *head = [handle readDataOfLength:0x200];
  [handle closeFile];
  std::string ext = path.pathExtension.lowercaseString.UTF8String;
  return romcheck::sniff(ext, static_cast<const uint8_t *>(head.bytes), head.length);
}

// Mueve src a dest; si dest ya existe descarta src y devuelve dest (no sobrescribe ROMs del usuario)
static BOOL moveIntoPlace(NSString *src, NSString *dest, NSError **error) {
  NSFileManager *fm = NSFileManager.defaultManager;
  if ([fm fileExistsAtPath:dest]) {
    [fm removeItemAtPath:src error:nil];
    return YES;
  }
  return [fm moveItemAtPath:src toPath:dest error:error];
}

@interface Libretro : RCTEventEmitter <NativeLibretroSpec>
@end

@implementation Libretro {
  BOOL _listening;        // JS tiene listeners de gamepadStatus
  NSString *_romError;    // motivo del último fallo al abrir la ROM (nativo)
  NSString *_coreId;      // núcleo cargado ('mgba' | 'genesis' | 'mupen64' | 'mame')
}

RCT_EXPORT_MODULE(Libretro)

- (NSArray<NSString *> *)supportedEvents {
  return @[ @"gamepadStatus" ];
}

- (void)startObserving {
  _listening = YES;
  // Estado actual al suscribirse (el mando puede estar conectado de antes)
  [self sendStatus:[[GamepadBridge sharedBridge] currentStatus]];
}

- (void)stopObserving {
  _listening = NO;
}

- (void)sendStatus:(NSDictionary *)status {
  if (_listening) {
    [self sendEventWithName:@"gamepadStatus" body:status];
  }
}

- (NSNumber *)hasDualSense {
  return @([[GamepadBridge sharedBridge] isDualSenseConnected]);
}

- (instancetype)init {
  if (self = [super init]) {
    NSFileManager *fm = NSFileManager.defaultManager;
    NSString *docs = documentsDirectory();
    NSString *system = [docs stringByAppendingPathComponent:@"system"];
    NSString *saves = [docs stringByAppendingPathComponent:@"saves"];
    [fm createDirectoryAtPath:system withIntermediateDirectories:YES attributes:nil error:nil];
    [fm createDirectoryAtPath:saves withIntermediateDirectories:YES attributes:nil error:nil];
    // Carpetas por consola, visibles en la app Archivos (UIFileSharingEnabled)
    createConsoleFolders(docs);
    host::configure(system.UTF8String, saves.UTF8String);

    __weak Libretro *weakSelf = self;
    [[GamepadBridge sharedBridge] startWithStatusHandler:^(NSDictionary *status) {
      [weakSelf sendStatus:status];
    }];
  }
  return self;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeLibretroSpecJSI>(params);
}

- (NSNumber *)loadCore:(NSString *)coreId {
  NSDictionary<NSString *, NSString *> *frameworks = @{
    @"mgba" : @"mgba_libretro",
    @"genesis" : @"genesis_plus_gx_libretro",
    @"mupen64" : @"mupen64plus_next_libretro",
    @"mame" : @"mame2003_plus_libretro",
  };
  NSString *name = frameworks[coreId];
  if (!name) return @NO;
  _coreId = coreId;
  NSString *path = [NSString stringWithFormat:@"%@/%@.framework/%@",
                                              NSBundle.mainBundle.privateFrameworksPath, name, name];
  return @(host::loadCore(path.UTF8String));
}

- (NSNumber *)loadGame:(NSString *)romPath {
  _romError = nil;
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *path = normalizeRomPath(romPath);
  BOOL isDir = NO;
  if (![fm fileExistsAtPath:path isDirectory:&isDir] || isDir) {
    _romError = [NSString stringWithFormat:@"No existe el archivo de la ROM: %@", path];
    return @NO;
  }
  if (![fm isReadableFileAtPath:path]) {
    _romError = [NSString stringWithFormat:@"Sin permiso de lectura para: %@", path];
    return @NO;
  }
  NSNumber *size = [fm attributesOfItemAtPath:path error:nil][NSFileSize];
  NSLog(@"[RetroEmu] loadGame core=%@ path=%@ size=%@ bytes", _coreId ?: @"(ninguno)", path, size);
  return @(host::loadGame(path.UTF8String));
}

- (NSString *)lastError {
  if (_romError) return _romError;
  std::string error = host::lastError();
  return [NSString stringWithUTF8String:error.c_str()];
}

- (void)unloadGame {
  host::unloadGame();
}

- (void)start {
  // .playback ignora el interruptor de silencio, como en cualquier juego
  NSError *error = nil;
  AVAudioSession *session = AVAudioSession.sharedInstance;
  [session setCategory:AVAudioSessionCategoryPlayback error:&error];
  [session setActive:YES error:&error];
  host::start();
}

- (void)stop {
  host::stop();
}

- (void)setPaused:(BOOL)paused {
  host::setPaused(paused);
}

- (void)reset {
  host::reset();
}

- (void)setButtons:(double)mask {
  host::setButtons((uint16_t)mask);
}

- (void)setAnalog:(double)x y:(double)y {
  host::setAnalog(x, y);
}

- (NSNumber *)saveState:(double)slot {
  return @(host::saveState((int)slot));
}

- (NSNumber *)loadState:(double)slot {
  return @(host::loadState((int)slot));
}

// Solo ROMs verificadas por contenido. Los zips se inspeccionan por dentro y se extraen
// a la carpeta de su consola; los zips sin ROM reconocible son candidatos arcade.
- (NSArray<NSString *> *)listRoms {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *docs = documentsDirectory();
  createConsoleFolders(docs);  // por si no existían al arrancar
  romzip::Folders folders = romFolders(docs);

  NSMutableArray<NSString *> *roms = [NSMutableArray array];
  NSMutableArray<NSString *> *arcade = [NSMutableArray array];
  NSDirectoryEnumerator<NSString *> *en = [fm enumeratorAtPath:docs];
  for (NSString *rel in en) {
    NSString *top = [rel componentsSeparatedByString:@"/"].firstObject;
    if ([top isEqualToString:@"system"] || [top isEqualToString:@"saves"]) {
      [en skipDescendants];  // BIOS y saves no son ROMs
      continue;
    }
    NSString *ext = rel.pathExtension.lowercaseString;
    NSString *full = [docs stringByAppendingPathComponent:rel];
    if ([ext isEqualToString:@"zip"]) {
      std::string extracted = romzip::extractRom(full.UTF8String, folders);
      if (!extracted.empty()) {
        [roms addObject:[NSString stringWithUTF8String:extracted.c_str()]];
      } else {
        [arcade addObject:full];  // el core de arcade lo valida al cargar
      }
      continue;
    }
    if (romcheck::isRomExtension(ext.UTF8String) && consoleForKind(sniffFile(full)) != nil) {
      [roms addObject:full];
    }
  }
  [roms addObjectsFromArray:arcade];
  // Un ROM extraído puede aparecer dos veces en la misma pasada: deduplicar
  return [[NSOrderedSet orderedSetWithArray:roms] array];
}

// Importa una descarga: zip -> extrae la ROM a su consola (o lo deja en mame/ si no hay ROM);
// ROM suelta -> la mueve a su carpeta de consola. Devuelve la ruta final o '' (ver lastError).
- (NSString *)importRom:(NSString *)downloadedPath {
  _romError = nil;
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *src = normalizeRomPath(downloadedPath);
  BOOL isDir = NO;
  if (![fm fileExistsAtPath:src isDirectory:&isDir] || isDir) {
    _romError = @"No se encuentra el archivo descargado";
    return @"";
  }
  NSString *docs = documentsDirectory();
  createConsoleFolders(docs);
  romzip::Folders folders = romFolders(docs);
  NSString *name = src.lastPathComponent;
  NSString *ext = src.pathExtension.lowercaseString;

  if ([ext isEqualToString:@"zip"]) {
    NSFileHandle *handle = [NSFileHandle fileHandleForReadingAtPath:src];
    NSData *magic = [handle readDataOfLength:4];
    [handle closeFile];
    const uint8_t sig[4] = {'P', 'K', 3, 4};
    if (magic.length < 4 || memcmp(magic.bytes, sig, 4) != 0) {
      _romError = [NSString stringWithFormat:@"\"%@\" no es un .zip válido (la descarga pudo fallar)", name];
      return @"";
    }
    std::string extracted = romzip::extractRom(src.UTF8String, folders);
    if (!extracted.empty()) {
      [fm removeItemAtPath:src error:nil];
      return [NSString stringWithUTF8String:extracted.c_str()];
    }
    // Zip sin ROM reconocible: candidato arcade, se guarda en mame/
    NSString *dest = [[docs stringByAppendingPathComponent:@"mame"] stringByAppendingPathComponent:name];
    NSError *error = nil;
    if (!moveIntoPlace(src, dest, &error)) {
      _romError = error.localizedDescription;
      return @"";
    }
    return dest;
  }

  if (!romcheck::isRomExtension(ext.UTF8String)) {
    _romError = [NSString stringWithFormat:@"Formato no soportado: .%@", ext];
    return @"";
  }
  NSString *console = consoleForKind(sniffFile(src));
  if (!console) {
    _romError = [NSString stringWithFormat:@"\"%@\" no tiene una cabecera válida para GBA, N64 o Mega Drive", name];
    return @"";
  }
  NSString *dest = [[docs stringByAppendingPathComponent:console] stringByAppendingPathComponent:name];
  NSError *error = nil;
  if (!moveIntoPlace(src, dest, &error)) {
    _romError = error.localizedDescription;
    return @"";
  }
  return dest;
}

// Consola a la que pertenece una ROM: 'gba' | 'n64' | 'sega' | 'mame' | '' (no verificada)
- (NSString *)consoleOf:(NSString *)romPath {
  NSString *path = normalizeRomPath(romPath);
  if ([path.pathExtension.lowercaseString isEqualToString:@"zip"]) return @"mame";
  return consoleForKind(sniffFile(path)) ?: @"";
}

@end
