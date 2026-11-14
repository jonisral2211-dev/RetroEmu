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

// Carpetas dentro de Documents: una por consola + states/ (save states)
static NSArray<NSString *> *consoleFolders(void) {
  return @[ @"n64", @"gba", @"sega", @"arcade", @"ps1", @"psp", @"nds", @"saturn", @"fbneo", @"states" ];
}

// BIOS de Neo-Geo para MAME 2003-Plus: no es un juego, nunca se lista
static NSString *const kNeoGeoBios = @"neogeo.zip";

// Versiones anteriores usaban Documents/mame/: su contenido se mueve a arcade/ (sin sobrescribir)
static void migrateLegacyArcadeFolder(NSString *docs) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *legacy = [docs stringByAppendingPathComponent:@"mame"];
  NSString *arcade = [docs stringByAppendingPathComponent:@"arcade"];
  BOOL isDir = NO;
  if (![fm fileExistsAtPath:legacy isDirectory:&isDir] || !isDir) return;
  for (NSString *name in [fm contentsOfDirectoryAtPath:legacy error:nil]) {
    NSString *dest = [arcade stringByAppendingPathComponent:name];
    if (![fm fileExistsAtPath:dest]) {
      [fm moveItemAtPath:[legacy stringByAppendingPathComponent:name] toPath:dest error:nil];
    }
  }
  if ([fm contentsOfDirectoryAtPath:legacy error:nil].count == 0) {
    [fm removeItemAtPath:legacy error:nil];
  }
}

// Crea las carpetas (idempotente) y migra mame/ -> arcade/
static void createConsoleFolders(NSString *docs) {
  NSFileManager *fm = NSFileManager.defaultManager;
  for (NSString *folder in consoleFolders()) {
    [fm createDirectoryAtPath:[docs stringByAppendingPathComponent:folder]
        withIntermediateDirectories:YES
                         attributes:nil
                              error:nil];
  }
  migrateLegacyArcadeFolder(docs);
}

static BOOL isInDocsFolder(NSString *path, NSString *folder) {
  NSString *dir = [[[documentsDirectory() stringByAppendingPathComponent:folder] stringByStandardizingPath]
      stringByAppendingString:@"/"];
  return [path.stringByStandardizingPath hasPrefix:dir];
}

// true si la ruta está dentro de Documents/arcade/ o Documents/fbneo/ (romsets arcade: solo esos
// .zip se abren con MAME 2003-Plus o FBNeo)
static BOOL isInArcadeFolder(NSString *path) {
  return isInDocsFolder(path, @"arcade") || isInDocsFolder(path, @"fbneo");
}

static BOOL isNeoGeoBios(NSString *path) {
  return [path.lastPathComponent.lowercaseString isEqualToString:kNeoGeoBios];
}

// MAME 2003-Plus y FBNeo buscan la BIOS de Neo-Geo junto a la ROM. Se comparte una sola copia:
// si falta en la carpeta del juego (arcade/ o fbneo/), se copia desde la otra carpeta arcade,
// system/, system/mame2003-plus/ o system/fbneo/.
static void ensureNeoGeoBios(NSString *systemDir, NSString *gameDir) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *dest = [gameDir stringByAppendingPathComponent:kNeoGeoBios];
  if ([fm fileExistsAtPath:dest]) return;
  NSString *docs = documentsDirectory();
  NSArray<NSString *> *candidates = @[
    [[docs stringByAppendingPathComponent:@"arcade"] stringByAppendingPathComponent:kNeoGeoBios],
    [[docs stringByAppendingPathComponent:@"fbneo"] stringByAppendingPathComponent:kNeoGeoBios],
    [systemDir stringByAppendingPathComponent:kNeoGeoBios],
    [[systemDir stringByAppendingPathComponent:@"mame2003-plus"] stringByAppendingPathComponent:kNeoGeoBios],
    [[systemDir stringByAppendingPathComponent:@"fbneo"] stringByAppendingPathComponent:kNeoGeoBios],
  ];
  for (NSString *src in candidates) {
    if ([fm fileExistsAtPath:src]) {
      NSError *error = nil;
      if ([fm copyItemAtPath:src toPath:dest error:&error]) {
        NSLog(@"[RetroEmu] neogeo.zip copiado de %@ a %@", src, gameDir.lastPathComponent);
      } else {
        NSLog(@"[RetroEmu] no se pudo copiar neogeo.zip: %@", error);
      }
      return;
    }
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
  f.nds = [docs stringByAppendingPathComponent:@"nds"].UTF8String;
  return f;
}

// Consola de un tipo de ROM verificado por contenido (nil = no verificada)
static NSString *consoleForKind(romcheck::Kind kind) {
  switch (kind) {
    case romcheck::Kind::GBA: return @"gba";
    case romcheck::Kind::N64: return @"n64";
    case romcheck::Kind::Sega: return @"sega";
    case romcheck::Kind::PS1: return @"ps1";
    case romcheck::Kind::NDS: return @"nds";
    case romcheck::Kind::Saturn: return @"saturn";
    case romcheck::Kind::PSP: return @"psp";
    default: return nil;
  }
}

// Lee solo la cabecera del archivo y la inspecciona según su extensión
static romcheck::Kind sniffFile(NSString *path) {
  NSFileHandle *handle = [NSFileHandle fileHandleForReadingAtPath:path];
  if (!handle) return romcheck::Kind::Unknown;
  NSData *head = [handle readDataOfLength:romcheck::kHeadSize];
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

// Bin al que apunta un .cue (primera línea FILE). Devuelve la ruta absoluta o nil.
static NSString *cueReferencedBin(NSString *cuePath) {
  NSString *text = [NSString stringWithContentsOfFile:cuePath encoding:NSUTF8StringEncoding error:nil];
  if (!text) text = [NSString stringWithContentsOfFile:cuePath encoding:NSISOLatin1StringEncoding error:nil];
  if (!text) return nil;
  NSString *name = nil;
  for (NSString *line in [text componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
    NSString *t = [line stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    if (![t hasPrefix:@"FILE "]) continue;
    NSString *rest = [t substringFromIndex:5];
    NSRange open = [rest rangeOfString:@"\""];
    if (open.location != NSNotFound) {
      NSString *after = [rest substringFromIndex:open.location + 1];
      NSRange close = [after rangeOfString:@"\""];
      if (close.location != NSNotFound) name = [after substringToIndex:close.location];
    } else {
      name = [rest componentsSeparatedByString:@" "].firstObject;
    }
    break;
  }
  if (name.length == 0) return nil;
  return [[cuePath stringByDeletingLastPathComponent] stringByAppendingPathComponent:name];
}

// Todos los archivos que referencia un .cue (una línea FILE por pista), como rutas absolutas
static NSArray<NSString *> *cueReferencedFiles(NSString *cuePath) {
  NSString *text = [NSString stringWithContentsOfFile:cuePath encoding:NSUTF8StringEncoding error:nil];
  if (!text) text = [NSString stringWithContentsOfFile:cuePath encoding:NSISOLatin1StringEncoding error:nil];
  if (!text) return @[];
  NSString *dir = [cuePath stringByDeletingLastPathComponent];
  NSMutableArray<NSString *> *files = [NSMutableArray array];
  for (NSString *line in [text componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
    NSString *t = [line stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    if (![t hasPrefix:@"FILE "]) continue;
    NSString *rest = [t substringFromIndex:5];
    NSString *name = nil;
    NSRange open = [rest rangeOfString:@"\""];
    if (open.location != NSNotFound) {
      NSString *after = [rest substringFromIndex:open.location + 1];
      NSRange close = [after rangeOfString:@"\""];
      if (close.location != NSNotFound) name = [after substringToIndex:close.location];
    } else {
      name = [rest componentsSeparatedByString:@" "].firstObject;
    }
    if (name.length) [files addObject:[dir stringByAppendingPathComponent:name]];
  }
  return files;
}

// Romsets arcade conocidos por nombre (Neo-Geo y clásicos): van directos a arcade/
static BOOL isKnownArcadeSet(NSString *fileName) {
  static NSArray<NSString *> *prefixes;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    // Solo prefijos inequívocos (nombres cortos de romset MAME); "mk", "tmnt", "sf2"… se
    // excluyen porque chocarían con zips de consola ("mk64.zip"). El resto lo cubre la regla
    // general: zip sin ROM de consola dentro -> arcade/.
    prefixes = @[
      @"neogeo", @"kof", @"mslug", @"bublbobl", @"garou", @"samsho", @"rbff", @"fatfury",
      @"lastblad", @"blazstar", @"pulstar", @"ssideki", @"nam1975", @"sengoku", @"kizuna",
      @"matrim", @"sfiii", @"mvsc", @"xmvsf", @"punisher", @"ddsom", @"ffight", @"mspacman",
      @"dkong", @"nbajam", @"shocktro", @"twinspri", @"neobombe", @"puzzledp", @"tophuntr",
    ];
  });
  NSString *base = fileName.stringByDeletingPathExtension.lowercaseString;
  for (NSString *p in prefixes) {
    if ([base hasPrefix:p]) return YES;
  }
  return NO;
}

// Juegos de Neo-Geo (necesitan la BIOS neogeo.zip). Nombres cortos de romset MAME.
static BOOL isNeoGeoSet(NSString *fileName) {
  static NSArray<NSString *> *prefixes;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    prefixes = @[
      @"kof", @"mslug", @"garou", @"samsho", @"rbff", @"fatfury", @"lastblad", @"blazstar",
      @"pulstar", @"ssideki", @"nam1975", @"sengoku", @"kizuna", @"matrim", @"shocktro",
      @"twinspri", @"neobombe", @"puzzledp", @"tophuntr", @"aof", @"wh1", @"wh2", @"whp",
      @"svc", @"mutnat", @"magdrop", @"lresort", @"neodrift", @"ragnagrd", @"breakers",
      @"kotm", @"lbowling", @"pbobble", @"bstars", @"neocup", @"turfmast", @"overtop",
    ];
  });
  NSString *base = fileName.stringByDeletingPathExtension.lowercaseString;
  if ([base isEqualToString:@"neogeo"]) return NO;
  for (NSString *p in prefixes) {
    if ([base hasPrefix:p]) return YES;
  }
  return NO;
}

// Por debajo de este tamaño un .zip de arcade está vacío o dañado (descarga cortada)
static const unsigned long long kMinArcadeZipBytes = 20 * 1024;

static unsigned long long fileSizeAt(NSString *path) {
  return [[NSFileManager.defaultManager attributesOfItemAtPath:path error:nil][NSFileSize] unsignedLongLongValue];
}

// Mueve src a dest solo si dest no existe. Nunca borra ni sobrescribe: si ya hay una copia en la
// carpeta de destino, el archivo de la raíz se queda y la biblioteca lo oculta como duplicado.
static BOOL moveIfFree(NSString *src, NSString *dest) {
  NSFileManager *fm = NSFileManager.defaultManager;
  if ([fm fileExistsAtPath:dest]) return NO;
  NSError *error = nil;
  if (![fm moveItemAtPath:src toPath:dest error:&error]) {
    NSLog(@"[RetroEmu] no se pudo mover %@ -> %@: %@", src.lastPathComponent, dest, error);
    return NO;
  }
  NSLog(@"[RetroEmu] organizado: %@ -> %@", src.lastPathComponent,
        [dest.stringByDeletingLastPathComponent lastPathComponent]);
  return YES;
}

// Auto-organización de la raíz de Documents (al arrancar y al pulsar Actualizar):
//  - .zip arcade (romset conocido o zip sin ROM de consola dentro) -> arcade/
//  - .cue (+ todas sus pistas), .bin/.iso de PS1 y .chd -> ps1/
//  - ROMs sueltas de otras consolas verificadas por cabecera -> su carpeta
static void organizeDocumentsRoot(NSString *docs, const romzip::Folders &folders) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *arcade = [docs stringByAppendingPathComponent:@"arcade"];
  NSString *ps1 = [docs stringByAppendingPathComponent:@"ps1"];
  NSArray<NSString *> *names = [fm contentsOfDirectoryAtPath:docs error:nil];

  // 1) .cue primero: arrastran sus pistas .bin a ps1/ o saturn/ según la pista principal
  NSMutableSet<NSString *> *handled = [NSMutableSet set];
  for (NSString *name in names) {
    if (![name.pathExtension.lowercaseString isEqualToString:@"cue"]) continue;
    NSString *cue = [docs stringByAppendingPathComponent:name];
    NSArray<NSString *> *tracks = cueReferencedFiles(cue);
    if (tracks.count == 0) continue;
    NSString *first = tracks.firstObject;
    NSString *destDir = nil;
    if ([fm fileExistsAtPath:first]) {
      const romcheck::Kind kind = sniffFile(first);
      if (kind == romcheck::Kind::PS1) destDir = ps1;
      if (kind == romcheck::Kind::Saturn) destDir = [docs stringByAppendingPathComponent:@"saturn"];
    } else if ([fm fileExistsAtPath:[ps1 stringByAppendingPathComponent:first.lastPathComponent]]) {
      destDir = ps1;
    }
    if (!destDir) continue;
    [handled addObject:cue];
    for (NSString *track in tracks) {
      [handled addObject:track];
      // Solo pistas que estén en la raíz (no se tocan subcarpetas del usuario)
      if ([track.stringByDeletingLastPathComponent.stringByStandardizingPath
              isEqualToString:docs.stringByStandardizingPath]) {
        moveIfFree(track, [destDir stringByAppendingPathComponent:track.lastPathComponent]);
      }
    }
    moveIfFree(cue, [destDir stringByAppendingPathComponent:name]);
  }

  // 2) Resto de archivos de la raíz
  for (NSString *name in names) {
    NSString *full = [docs stringByAppendingPathComponent:name];
    if ([handled containsObject:full]) continue;
    BOOL isDir = NO;
    if (![fm fileExistsAtPath:full isDirectory:&isDir] || isDir) continue;
    NSString *ext = name.pathExtension.lowercaseString;

    if ([ext isEqualToString:@"zip"]) {
      if (isNeoGeoBios(full) || isKnownArcadeSet(name)) {
        moveIfFree(full, [arcade stringByAppendingPathComponent:name]);
        continue;
      }
      // Zip con ROM de consola: se extrae a su carpeta (el zip se queda donde está)
      if (!romzip::extractRom(full.UTF8String, folders).empty()) continue;
      // Sin ROM de consola ni de consolas no soportadas: romset arcade
      if (romzip::foreignEntry(full.UTF8String).empty()) {
        moveIfFree(full, [arcade stringByAppendingPathComponent:name]);
      }
      continue;
    }
    if ([ext isEqualToString:@"chd"]) {
      moveIfFree(full, [ps1 stringByAppendingPathComponent:name]);
      continue;
    }
    if (!romcheck::isRomExtension(ext.UTF8String) || [ext isEqualToString:@"cue"]) continue;
    NSString *console = consoleForKind(sniffFile(full));
    if (console) {
      moveIfFree(full, [[docs stringByAppendingPathComponent:console] stringByAppendingPathComponent:name]);
    }
  }
}

@interface Libretro : RCTEventEmitter <NativeLibretroSpec>
@end

@implementation Libretro {
  BOOL _listening;        // JS tiene listeners de gamepadStatus
  NSString *_romError;    // motivo del último fallo al abrir la ROM (nativo)
  NSString *_coreId;      // núcleo cargado ('mgba' | 'genesis' | 'mupen64' | 'mame' | 'pcsx')
  NSString *_systemDir;   // Documents/system (BIOS)
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
    NSString *states = [docs stringByAppendingPathComponent:@"states"];
    [fm createDirectoryAtPath:system withIntermediateDirectories:YES attributes:nil error:nil];
    [fm createDirectoryAtPath:saves withIntermediateDirectories:YES attributes:nil error:nil];
    // n64/ gba/ sega/ arcade/ ps1/ states/, visibles en la app Archivos (UIFileSharingEnabled)
    createConsoleFolders(docs);
    _systemDir = system;
    host::configure(system.UTF8String, saves.UTF8String, states.UTF8String);

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
    @"pcsx" : @"pcsx_rearmed_libretro",
    @"melonds" : @"melonds_libretro",
    @"desmume" : @"desmume_libretro",
    @"yabause" : @"yabause_libretro",
    @"fbneo" : @"fbneo_libretro",
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
  if ([_coreId isEqualToString:@"mame"] || [_coreId isEqualToString:@"fbneo"]) {
    if (!isInArcadeFolder(path)) {
      _romError = [NSString stringWithFormat:@"\"%@\" está fuera de las carpetas arcade/ y fbneo/. Los .zip de "
                                             @"arcade (MAME, FBNeo, Neo-Geo) deben estar en una de ellas.",
                                             path.lastPathComponent];
      return @NO;
    }
    NSString *gameDir = path.stringByDeletingLastPathComponent;
    // Comprobaciones antes de arrancar MAME, con el motivo exacto para el usuario
    const unsigned long long bytes = fileSizeAt(path);
    if (bytes < kMinArcadeZipBytes) {
      _romError = [NSString stringWithFormat:
                                @"\"%@\" pesa solo %.1f KB: el archivo está dañado o la descarga se cortó. "
                                @"Un juego arcade real ocupa mucho más. Vuelve a descargarlo y cópialo en arcade/.",
                                path.lastPathComponent, bytes / 1024.0];
      return @NO;
    }
    ensureNeoGeoBios(_systemDir, gameDir);  // KOF, Metal Slug… necesitan neogeo.zip junto a la ROM
    if (isNeoGeoSet(path.lastPathComponent)) {
      NSString *bios = [gameDir stringByAppendingPathComponent:kNeoGeoBios];
      if (![fm fileExistsAtPath:bios]) {
        _romError = [NSString stringWithFormat:
                                  @"\"%@\" es un juego de Neo-Geo y falta la BIOS neogeo.zip. Cópiala en "
                                  @"arcade/, fbneo/ o system/ con la app Archivos y vuelve a abrir el juego.",
                                  path.lastPathComponent];
        return @NO;
      }
      if (fileSizeAt(bios) < kMinArcadeZipBytes) {
        _romError = [NSString stringWithFormat:
                                  @"neogeo.zip pesa solo %.1f KB: la BIOS de Neo-Geo está dañada. Sustitúyela "
                                  @"por una copia completa.",
                                  fileSizeAt(bios) / 1024.0];
        return @NO;
      }
    }
  }
  NSNumber *size = [fm attributesOfItemAtPath:path error:nil][NSFileSize];
  NSLog(@"[RetroEmu] loadGame core=%@ path=%@ size=%@ bytes", _coreId ?: @"(ninguno)", path, size);
  return @(host::loadGame(path.UTF8String));
}

- (void)setPointer:(double)x y:(double)y pressed:(BOOL)pressed {
  host::setPointer(x, y, pressed);
}

- (void)setCoreOption:(NSString *)key value:(NSString *)value {
  host::setOption(key.UTF8String, value.UTF8String);
}

- (NSNumber *)videoAspect {
  return @(host::aspectRatio());
}

- (NSString *)debugState {
  return [NSString stringWithUTF8String:host::debugState().c_str()];
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
  organizeDocumentsRoot(docs, folders);

  NSMutableArray<NSString *> *roms = [NSMutableArray array];
  NSMutableArray<NSString *> *arcade = [NSMutableArray array];
  // Pistas .cue: su .bin lo carga el .cue, así que ese .bin no se lista por separado
  NSMutableSet<NSString *> *cueBins = [NSMutableSet set];
  for (NSString *rel in [fm subpathsOfDirectoryAtPath:docs error:nil]) {
    if ([rel.pathExtension.lowercaseString isEqualToString:@"cue"]) {
      NSString *bin = cueReferencedBin([docs stringByAppendingPathComponent:rel]);
      if (bin) [cueBins addObject:bin];
    }
  }
  NSDirectoryEnumerator<NSString *> *en = [fm enumeratorAtPath:docs];
  for (NSString *rel in en) {
    NSString *top = [rel componentsSeparatedByString:@"/"].firstObject;
    if ([top isEqualToString:@"system"] || [top isEqualToString:@"saves"] ||
        [top isEqualToString:@"states"] || [top isEqualToString:@"covers"]) {
      [en skipDescendants];  // BIOS, SRAM, save states y carátulas no son ROMs
      continue;
    }
    NSString *ext = rel.pathExtension.lowercaseString;
    NSString *full = [docs stringByAppendingPathComponent:rel];
    if ([ext isEqualToString:@"zip"]) {
      if (isNeoGeoBios(full)) continue;  // BIOS de Neo-Geo, no es un juego
      if (isInArcadeFolder(full)) {
        // arcade/ y fbneo/: romsets, sin extraer (el core valida el romset al cargar)
        if (romzip::foreignEntry(full.UTF8String).empty()) [arcade addObject:full];
        continue;
      }
      // Fuera de arcade/: un zip con ROM de consola se extrae a su carpeta
      std::string extracted = romzip::extractRom(full.UTF8String, folders);
      if (!extracted.empty()) {
        [roms addObject:[NSString stringWithUTF8String:extracted.c_str()]];
      } else if (romzip::foreignEntry(full.UTF8String).empty()) {
        // Probable romset arcade mal ubicado: se lista para avisar al usuario (consoleOf = '')
        [arcade addObject:full];
      }
      continue;
    }
    if ([ext isEqualToString:@"cue"]) {
      NSString *bin = cueReferencedBin(full);
      NSString *console = bin ? consoleForKind(sniffFile(bin)) : nil;
      if (console) [roms addObject:full];
      continue;
    }
    if ([cueBins containsObject:full]) continue;  // lo carga su .cue
    if (romcheck::isRomExtension(ext.UTF8String) && consoleForKind(sniffFile(full)) != nil) {
      [roms addObject:full];
    }
  }
  [roms addObjectsFromArray:arcade];
  // Duplicados visuales: el mismo juego (nombre de archivo) en la raíz y en una subcarpeta,
  // o extraído dos veces. Se conserva la copia de la subcarpeta (la más profunda).
  NSMutableDictionary<NSString *, NSString *> *byName = [NSMutableDictionary dictionary];
  NSMutableArray<NSString *> *order = [NSMutableArray array];
  for (NSString *path in roms) {
    NSString *key = path.lastPathComponent.lowercaseString;
    NSString *prev = byName[key];
    if (!prev) {
      byName[key] = path;
      [order addObject:key];
    } else if (path.pathComponents.count > prev.pathComponents.count) {
      byName[key] = path;
    }
  }
  NSMutableArray<NSString *> *unique = [NSMutableArray arrayWithCapacity:order.count];
  for (NSString *key in order) [unique addObject:byName[key]];
  return unique;
}

// Importa una descarga: zip -> extrae la ROM a su consola (o lo deja en arcade/ si no hay ROM);
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
    std::string foreign = romzip::foreignEntry(src.UTF8String);
    if (!foreign.empty()) {
      _romError = [NSString stringWithFormat:@"\"%@\" contiene \"%s\", de una consola no soportada por RetroEmu. No se envía a MAME.",
                                             name, foreign.c_str()];
      return @"";
    }
    // Zip sin ROM reconocible: candidato arcade, se guarda en arcade/
    NSString *dest = [[docs stringByAppendingPathComponent:@"arcade"] stringByAppendingPathComponent:name];
    NSError *error = nil;
    if (!moveIntoPlace(src, dest, &error)) {
      _romError = error.localizedDescription;
      return @"";
    }
    return dest;
  }

  if ([ext isEqualToString:@"7z"]) {
    [fm removeItemAtPath:src error:nil];
    _romError = [NSString stringWithFormat:@"\"%@\" es un .7z: este formato aún no se puede descomprimir dentro "
                                           @"de la app. Busca la versión .zip del juego.",
                                           name];
    return @"";
  }
  if (!romcheck::isRomExtension(ext.UTF8String)) {
    _romError = [NSString stringWithFormat:@"Formato no soportado: .%@", ext];
    return @"";
  }
  NSString *console = consoleForKind(sniffFile(src));
  // PS1: la hoja .cue y los .chd van a ps1/; las pistas .bin de audio (sin cabecera de datos)
  // también, si algún .cue de ps1/ las referencia
  if (!console && [ext isEqualToString:@"cue"]) {
    // La hoja .cue sola no tiene cabecera: se mira su primera pista si ya está descargada
    NSString *bin = cueReferencedBin(src);
    NSString *saturnBin = bin ? [[docs stringByAppendingPathComponent:@"saturn"]
                                    stringByAppendingPathComponent:bin.lastPathComponent]
                              : nil;
    console = (saturnBin && [fm fileExistsAtPath:saturnBin]) ? @"saturn" : @"ps1";
  }
  if (!console && [ext isEqualToString:@"chd"]) console = @"ps1";
  if (!console && [ext isEqualToString:@"bin"]) {
    NSString *ps1 = [docs stringByAppendingPathComponent:@"ps1"];
    for (NSString *f in [fm contentsOfDirectoryAtPath:ps1 error:nil]) {
      if (![f.pathExtension.lowercaseString isEqualToString:@"cue"]) continue;
      for (NSString *track in cueReferencedFiles([ps1 stringByAppendingPathComponent:f])) {
        if ([track.lastPathComponent caseInsensitiveCompare:name] == NSOrderedSame) console = @"ps1";
      }
    }
  }
  if (!console) {
    _romError = [NSString stringWithFormat:@"\"%@\" no tiene una cabecera válida de ninguna consola soportada", name];
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

// Consola de una ROM: 'gba' | 'n64' | 'sega' | 'mame' | 'fbneo' | 'ps1' | 'nds' | 'saturn' |
// 'psp' | '' (no verificada)
- (NSString *)consoleOf:(NSString *)romPath {
  NSString *path = normalizeRomPath(romPath);
  NSString *ext = path.pathExtension.lowercaseString;
  if ([ext isEqualToString:@"zip"]) {
    // Solo los .zip de arcade/ (MAME) y fbneo/ (FBNeo) son romsets; fuera, '' (la UI avisa)
    if (!isInArcadeFolder(path) || isNeoGeoBios(path)) return @"";
    if (!romzip::foreignEntry(path.UTF8String).empty()) return @"";
    return isInDocsFolder(path, @"fbneo") ? @"fbneo" : @"mame";
  }
  if ([ext isEqualToString:@"cue"]) {
    NSString *bin = cueReferencedBin(path);
    NSString *console = bin ? consoleForKind(sniffFile(bin)) : nil;
    return console ?: @"";
  }
  // .chd: comprimido, sin cabecera legible; decide la carpeta (saturn/ o ps1/)
  if ([ext isEqualToString:@"chd"]) {
    if (!(sniffFile(path) == romcheck::Kind::PS1)) return @"";
    return isInDocsFolder(path, @"saturn") ? @"saturn" : @"ps1";
  }
  return consoleForKind(sniffFile(path)) ?: @"";
}

@end
