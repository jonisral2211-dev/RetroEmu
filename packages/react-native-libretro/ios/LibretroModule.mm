#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

#import "GamepadBridge.h"
#import <ReactCommon/RCTTurboModule.h>
#import <RNLibretroSpec/RNLibretroSpec.h>

#include <memory>

#include <map>

#include "LibretroHost.hpp"
#include "RomArchive.hpp"

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

// Extensión -> carpeta de consola (los zips se extraen a la carpeta de su ROM)
static NSDictionary<NSString *, NSString *> *extensionFolders(void) {
  return @{
    @"gba" : @"gba", @"gb" : @"gba", @"gbc" : @"gba",
    @"z64" : @"n64", @"n64" : @"n64", @"v64" : @"n64",
    @"md" : @"sega", @"gen" : @"sega", @"smd" : @"sega", @"bin" : @"sega",
  };
}

static BOOL isRomExtension(NSString *ext) {
  static NSSet<NSString *> *exts;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    exts = [NSSet setWithArray:@[ @"gba", @"gb", @"gbc", @"md", @"gen", @"smd",
                                  @"bin", @"z64", @"n64", @"v64" ]];
  });
  return [exts containsObject:ext.lowercaseString];
}

@interface Libretro : RCTEventEmitter <NativeLibretroSpec>
@end

@implementation Libretro {
  BOOL _listening;        // JS tiene listeners de gamepadStatus
  NSString *_romError;    // motivo del último fallo al abrir la ROM (nativo)
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
  };
  NSString *name = frameworks[coreId];
  if (!name) return @NO;
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

- (NSArray<NSString *> *)listRoms {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *docs = documentsDirectory();
  createConsoleFolders(docs);  // por si no existían al arrancar

  // Mapa extensión -> carpeta absoluta para el extractor de zips
  std::map<std::string, std::string> extToDir;
  NSDictionary *folders = extensionFolders();
  for (NSString *ext in folders) {
    NSString *dir = [docs stringByAppendingPathComponent:folders[ext]];
    extToDir[ext.UTF8String] = dir.UTF8String;
  }

  NSMutableArray<NSString *> *roms = [NSMutableArray array];
  NSMutableArray<NSString *> *zipsWithoutRom = [NSMutableArray array];
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
      // Zip con ROM: se extrae a su carpeta de consola y se lista la ROM extraída
      std::string extracted = romzip::extractRom(full.UTF8String, extToDir);
      if (!extracted.empty()) {
        [roms addObject:[NSString stringWithUTF8String:extracted.c_str()]];
      } else {
        [zipsWithoutRom addObject:full];  // arcade u otro zip sin ROM conocida
      }
      continue;
    }
    if (isRomExtension(ext)) {
      [roms addObject:full];
    }
  }
  // Zips sin ROM conocida: se listan como arcade (no hay núcleo, la UI lo indica)
  [roms addObjectsFromArray:zipsWithoutRom];
  // Un ROM extraído puede aparecer dos veces en la misma pasada: deduplicar
  return [[NSOrderedSet orderedSetWithArray:roms] array];
}

@end
