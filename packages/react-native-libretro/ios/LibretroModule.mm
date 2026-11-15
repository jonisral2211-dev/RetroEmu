#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

#import "GamepadBridge.h"
#import "TVOutput.h"
#import <ReactCommon/RCTTurboModule.h>
#import <RNLibretroSpec/RNLibretroSpec.h>

#import <PhotosUI/PhotosUI.h>
#import <objc/runtime.h>

#include <memory>

#include <cstring>
#include <strings.h>
#include <map>

#include "LibretroHost.hpp"
#include "RomArchive.hpp"
#include "RomInspector.hpp"
#include "Unpack.hpp"

// ---- Selector de imagen de Fotos (Biblioteca → "Cambiar miniatura") -------------------------
// PHPicker no pide permiso de acceso a Fotos: el usuario solo comparte la imagen que elige.
@interface JLImagePicker : NSObject <PHPickerViewControllerDelegate>
@property(nonatomic, copy) NSString *dest;
@property(nonatomic, copy) void (^done)(BOOL ok);
@end

static JLImagePicker *g_imagePicker;  // vivo mientras el selector está abierto

@implementation JLImagePicker
- (void)picker:(PHPickerViewController *)picker didFinishPicking:(NSArray<PHPickerResult *> *)results {
  [picker dismissViewControllerAnimated:YES completion:nil];
  void (^finish)(BOOL) = self.done;
  NSString *dest = self.dest;
  g_imagePicker = nil;
  NSItemProvider *provider = results.firstObject.itemProvider;
  if (!provider || ![provider canLoadObjectOfClass:UIImage.class]) {
    finish(NO);
    return;
  }
  [provider loadObjectOfClass:UIImage.class
            completionHandler:^(id<NSItemProviderReading> object, NSError *error) {
              UIImage *image = [(NSObject *)object isKindOfClass:UIImage.class] ? (UIImage *)object : nil;
              BOOL ok = NO;
              if (image && image.size.width > 0 && image.size.height > 0) {
                // Carátula: como mucho 640 px de lado (carga instantánea en la cuadrícula)
                const CGFloat scale = MIN(1.0, 640.0 / MAX(image.size.width, image.size.height));
                const CGSize size = CGSizeMake(round(image.size.width * scale), round(image.size.height * scale));
                UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
                format.scale = 1;
                UIImage *small = [[[UIGraphicsImageRenderer alloc] initWithSize:size format:format]
                    imageWithActions:^(UIGraphicsImageRendererContext *ctx) {
                      [image drawInRect:CGRectMake(0, 0, size.width, size.height)];
                    }];
                [NSFileManager.defaultManager createDirectoryAtPath:dest.stringByDeletingLastPathComponent
                                        withIntermediateDirectories:YES
                                                         attributes:nil
                                                              error:nil];
                ok = [UIImagePNGRepresentation(small) writeToFile:dest atomically:YES];
              }
              finish(ok);
            }];
}
@end

static UIViewController *topViewController(void) {
  UIViewController *top = nil;
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:UIWindowScene.class]) continue;
    for (UIWindow *w in ((UIWindowScene *)scene).windows) {
      if (w.isKeyWindow) top = w.rootViewController;
    }
  }
  while (top.presentedViewController) top = top.presentedViewController;
  return top;
}

static NSString *documentsDirectory(void) {
  return NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
}

// Carpetas dentro de Documents: una por consola + states/ (save states)
static NSArray<NSString *> *consoleFolders(void) {
  return @[
    @"n64", @"gba", @"sega", @"arcade", @"ps1", @"psp", @"nds", @"saturn", @"fbneo", @"snes", @"nes", @"gb", @"gbc",
    @"ports", @"states"
  ];
}

// Consolas que aún no tienen núcleo en la app: el organizador las aparta en su carpeta
static NSDictionary<NSString *, NSString *> *unsupportedFolders(void) {
  // SNES, NES, GB y GBC ya tienen núcleo (Snes9x, FCEUmm, Gambatte): de momento ninguna
  return @{};
}

// Carpetas de consola donde un .zip o .7z se descomprime automáticamente (y se borra). arcade/ y
// fbneo/ no: allí los .zip son romsets que el core lee comprimidos.
static NSArray<NSString *> *unpackFolders(void) {
  return @[ @"psp", @"ps1", @"n64", @"gba", @"sega", @"saturn", @"nds", @"snes", @"nes", @"gb", @"gbc", @"ports" ];
}
// Descargas comprimidas grandes (o .7z): se descomprimen en segundo plano a la raíz de Documents
// y desde ahí la auto-organización reparte cada juego en su carpeta
static NSString *const kInbox = @".inbox";

static BOOL isArchiveName(NSString *name) {
  NSString *ext = name.pathExtension.lowercaseString;
  return ![name hasPrefix:@"."] && ([ext isEqualToString:@"zip"] || [ext isEqualToString:@"7z"]);
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

// ---- Ports (Doom, Quake, Wolfenstein 3D, Cave Story…) ------------------------------------------
// Núcleo que abre un archivo de port, o nil. Solo se lista el archivo "de arranque" de cada juego
// (pak0.pak, Doukutsu.exe, VSWAP.*, RPG_RT.ldb…), no el resto de sus datos.
static NSString *portCoreFor(NSString *path) {
  NSString *name = path.lastPathComponent.lowercaseString;
  NSString *ext = name.pathExtension;
  if ([ext isEqualToString:@"wad"] || [ext isEqualToString:@"iwad"]) {
    return [name isEqualToString:@"prboom.wad"] ? nil : @"prboom";
  }
  if ([ext isEqualToString:@"ecwolf"]) return @"ecwolf";
  if ([name hasPrefix:@"vswap."] &&
      [@[ @"wl6", @"wl1", @"sod", @"sdm", @"sd2", @"sd3", @"n3d" ] containsObject:ext]) {
    return @"ecwolf";
  }
  if ([name isEqualToString:@"pak0.pak"]) {
    NSString *parent = path.stringByDeletingLastPathComponent.lastPathComponent.lowercaseString;
    return [parent isEqualToString:@"baseq2"] ? @"vitaquake2" : @"tyrquake";
  }
  if ([name isEqualToString:@"doukutsu.exe"]) return @"nxengine";
  if ([ext isEqualToString:@"game"]) return @"cannonball";
  if ([name isEqualToString:@"level1.map"]) return @"reminiscence";
  if ([name isEqualToString:@"rpg_rt.ldb"] || [ext isEqualToString:@"easyrpg"]) return @"easyrpg";
  if ([ext isEqualToString:@"scummvm"]) return @"scummvm";
  return nil;
}

// Extensiones sueltas que pertenecen a ports (el organizador las lleva a ports/)
static BOOL isPortDataName(NSString *name) {
  NSString *lower = name.lowercaseString;
  NSString *ext = lower.pathExtension;
  return portCoreFor(name) != nil ||
         [@[ @"wad", @"iwad", @"pwad", @"deh", @"ecwolf", @"wl6", @"wl1", @"sod", @"pak", @"scummvm", @"ldb", @"lmt",
             @"game", @"easyrpg" ] containsObject:ext] ||
         [lower isEqualToString:@"doukutsu.exe"];
}

// .zip con un port dentro (Doukutsu.exe, .wad, pak0.pak, VSWAP, RPG_RT.ldb…)
static BOOL zipHasPort(NSString *zip) {
  for (const std::string &entry : unpack::listZipEntries(zip.UTF8String)) {
    NSString *e = [NSString stringWithUTF8String:entry.c_str()];
    if (e && isPortDataName(e.lastPathComponent)) return YES;
  }
  return NO;
}

// Cave Story (freeware, datos oficiales de libretro) viene dentro del núcleo NXEngine: se instala
// una vez en ports/Cave Story/ para que aparezca listo para jugar
static void installBundledPorts(NSString *docs) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *src = [NSBundle.mainBundle.privateFrameworksPath
      stringByAppendingPathComponent:@"nxengine_libretro.framework/CaveStory"];
  NSString *marker = [docs stringByAppendingPathComponent:@"system/.cavestory-installed"];
  if (![fm fileExistsAtPath:src] || [fm fileExistsAtPath:marker]) return;
  NSString *dest = [docs stringByAppendingPathComponent:@"ports/Cave Story"];
  [fm createDirectoryAtPath:[docs stringByAppendingPathComponent:@"ports"] withIntermediateDirectories:YES attributes:nil error:nil];
  if (![fm fileExistsAtPath:dest]) [fm copyItemAtPath:src toPath:dest error:nil];
  [fm createDirectoryAtPath:marker.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
  [[NSData data] writeToFile:marker atomically:YES];
}

static BOOL isNeoGeoBios(NSString *path) {
  return [path.lastPathComponent.lowercaseString isEqualToString:kNeoGeoBios];
}

// MAME 2003-Plus y FBNeo buscan la BIOS de Neo-Geo junto a la ROM. Se comparte una sola copia:
// si falta en la carpeta del juego (arcade/ o fbneo/), se copia desde la otra carpeta arcade,
// system/, system/mame2003-plus/ o system/fbneo/.
static unsigned long long fileSizeAt(NSString *path);
static const unsigned long long kNeoGeoMinBytes = 20 * 1024;

static void ensureNeoGeoBios(NSString *systemDir, NSString *gameDir) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *dest = [gameDir stringByAppendingPathComponent:kNeoGeoBios];
  const BOOL present = [fm fileExistsAtPath:dest];
  if (present && fileSizeAt(dest) >= kNeoGeoMinBytes) return;
  NSString *docs = documentsDirectory();
  NSArray<NSString *> *candidates = @[
    [docs stringByAppendingPathComponent:kNeoGeoBios],
    [[docs stringByAppendingPathComponent:@"arcade"] stringByAppendingPathComponent:kNeoGeoBios],
    [[docs stringByAppendingPathComponent:@"fbneo"] stringByAppendingPathComponent:kNeoGeoBios],
    [systemDir stringByAppendingPathComponent:kNeoGeoBios],
    [[systemDir stringByAppendingPathComponent:@"mame2003-plus"] stringByAppendingPathComponent:kNeoGeoBios],
    [[systemDir stringByAppendingPathComponent:@"fbneo"] stringByAppendingPathComponent:kNeoGeoBios],
  ];
  for (NSString *src in candidates) {
    if ([src isEqualToString:dest]) continue;
    if ([fm fileExistsAtPath:src] && fileSizeAt(src) >= kNeoGeoMinBytes) {
      NSError *error = nil;
      if (present) [fm removeItemAtPath:dest error:nil];  // copia dañada: se reemplaza
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
  f.snes = [docs stringByAppendingPathComponent:@"snes"].UTF8String;
  f.nes = [docs stringByAppendingPathComponent:@"nes"].UTF8String;
  f.gb = [docs stringByAppendingPathComponent:@"gb"].UTF8String;
  f.gbc = [docs stringByAppendingPathComponent:@"gbc"].UTF8String;
  return f;
}

// gb/ y gbc/ comparten núcleo (Gambatte): un juego en cualquiera de las dos está bien colocado
static BOOL isGameBoyPair(NSString *a, NSString *b) {
  NSArray<NSString *> *pair = @[ @"gb", @"gbc" ];
  return [pair containsObject:a] && [pair containsObject:b];
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
    case romcheck::Kind::SNES: return @"snes";
    case romcheck::Kind::NES: return @"nes";
    case romcheck::Kind::GB: return @"gb";
    case romcheck::Kind::GBC: return @"gbc";
    default: return nil;
  }
}

static uint64_t be64(const uint8_t *p) {
  uint64_t v = 0;
  for (int i = 0; i < 8; ++i) v = (v << 8) | p[i];
  return v;
}

// CHD: el contenido va comprimido, pero su metadato dice qué es. chdman createcd (PS1, Saturn)
// escribe pistas "CHT2"/"CHTR"/"CHCD"; createdvd (PSP, que solo acepta CHD de DVD) escribe "DVD ".
static romcheck::Kind chdKind(NSString *path) {
  NSFileHandle *h = [NSFileHandle fileHandleForReadingAtPath:path];
  if (!h) return romcheck::Kind::Unknown;
  NSData *head = [h readDataOfLength:64];
  const uint8_t *d = static_cast<const uint8_t *>(head.bytes);
  if (head.length < 56 || memcmp(d, "MComprHD", 8) != 0) {
    [h closeFile];
    return romcheck::Kind::Unknown;
  }
  const uint32_t version = (uint32_t(d[12]) << 24) | (uint32_t(d[13]) << 16) | (uint32_t(d[14]) << 8) | d[15];
  // Desplazamiento del primer metadato: v5 en 0x30, v3/v4 en 0x24
  uint64_t meta = version >= 5 ? be64(d + 48) : be64(d + 36);
  romcheck::Kind kind = romcheck::Kind::PS1;  // CD por defecto (comportamiento anterior)
  for (int i = 0; i < 32 && meta != 0; ++i) {
    @try {
      [h seekToFileOffset:meta];
    } @catch (NSException *) {
      break;
    }
    NSData *entry = [h readDataOfLength:16];
    if (entry.length < 16) break;
    const uint8_t *e = static_cast<const uint8_t *>(entry.bytes);
    if (memcmp(e, "DVD ", 4) == 0) {
      kind = romcheck::Kind::PSP;
      break;
    }
    if (memcmp(e, "CHT2", 4) == 0 || memcmp(e, "CHTR", 4) == 0 || memcmp(e, "CHCD", 4) == 0) break;
    meta = be64(e + 8);
  }
  [h closeFile];
  return kind;
}

// Lee solo la cabecera del archivo y la inspecciona según su extensión
static romcheck::Kind sniffFile(NSString *path) {
  if ([path.pathExtension.lowercaseString isEqualToString:@"chd"]) return chdKind(path);
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

// Un juego de PSP (.chd de DVD, .iso UMD, .cso, .pbp) dentro de ps1/ haría fallar a PCSX-ReARMed
// ("unsupported/invalid CD image"): se mueve a psp/.
static void relocatePspFromPs1(NSString *docs) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *ps1 = [docs stringByAppendingPathComponent:@"ps1"];
  NSString *psp = [docs stringByAppendingPathComponent:@"psp"];
  for (NSString *name in [fm contentsOfDirectoryAtPath:ps1 error:nil]) {
    NSString *ext = name.pathExtension.lowercaseString;
    if (![@[ @"chd", @"iso", @"cso", @"pbp" ] containsObject:ext]) continue;
    NSString *full = [ps1 stringByAppendingPathComponent:name];
    if (sniffFile(full) == romcheck::Kind::PSP) moveIfFree(full, [psp stringByAppendingPathComponent:name]);
  }
}

// Juegos de consola dentro de arcade/ o fbneo/ (ISO/CSO de PSP, CHD, .cue/.bin…) no son romsets:
// cada archivo suelto va a la carpeta de su consola, y un .zip/.7z con una imagen de disco dentro
// pasa a la bandeja para descomprimirse y repartirse. Solo se lee el índice del zip.
static void relocateFromArcade(NSString *docs) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *inbox = [docs stringByAppendingPathComponent:@".inbox"];
  for (NSString *folder in @[ @"arcade", @"fbneo" ]) {
    NSString *dir = [docs stringByAppendingPathComponent:folder];
    for (NSString *name in [fm contentsOfDirectoryAtPath:dir error:nil]) {
      if ([name hasPrefix:@"."]) continue;
      NSString *full = [dir stringByAppendingPathComponent:name];
      NSString *ext = name.pathExtension.lowercaseString;
      if ([ext isEqualToString:@"7z"]) {
        [fm createDirectoryAtPath:inbox withIntermediateDirectories:YES attributes:nil error:nil];
        moveIfFree(full, [inbox stringByAppendingPathComponent:name]);
        continue;
      }
      if ([ext isEqualToString:@"zip"]) {
        if (isNeoGeoBios(full)) continue;
        BOOL disc = NO;
        for (const std::string &entry : unpack::listZipEntries(full.UTF8String)) {
          NSString *e = [NSString stringWithUTF8String:entry.c_str()].pathExtension.lowercaseString;
          if ([@[ @"iso", @"cso", @"pbp", @"chd", @"cue", @"img" ] containsObject:e]) disc = YES;
        }
        if (disc) {
          [fm createDirectoryAtPath:inbox withIntermediateDirectories:YES attributes:nil error:nil];
          moveIfFree(full, [inbox stringByAppendingPathComponent:name]);
        }
        continue;
      }
      if ([ext isEqualToString:@"cue"]) {
        NSString *bin = cueReferencedBin(full);
        NSString *console = bin ? consoleForKind(sniffFile(bin)) : nil;
        if (!console) continue;
        NSString *destDir = [docs stringByAppendingPathComponent:console];
        for (NSString *track in cueReferencedFiles(full)) {
          moveIfFree(track, [destDir stringByAppendingPathComponent:track.lastPathComponent]);
        }
        moveIfFree(full, [destDir stringByAppendingPathComponent:name]);
        continue;
      }
      if (!romcheck::isRomExtension(ext.UTF8String)) continue;
      NSString *console = consoleForKind(sniffFile(full));
      if (console) moveIfFree(full, [[docs stringByAppendingPathComponent:console] stringByAppendingPathComponent:name]);
    }
  }
}

// ---- Organizador (Biblioteca → "Organizar archivos") ---------------------------------------
// Carpeta de destino de un archivo según extensión, contenido del .zip y cabecera; nil = no se sabe
static NSString *folderForExtension(NSString *ext) {
  static NSDictionary<NSString *, NSString *> *map;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    map = @{
      @"gba" : @"gba", @"agb" : @"gba", @"n64" : @"n64", @"z64" : @"n64", @"v64" : @"n64", @"nds" : @"nds",
      @"md" : @"sega", @"gen" : @"sega", @"smd" : @"sega", @"sms" : @"sega", @"gg" : @"sega", @"sg" : @"sega",
      @"cso" : @"psp", @"wad" : @"ports", @"sfc" : @"snes", @"smc" : @"snes", @"fig" : @"snes", @"swc" : @"snes", @"nes" : @"nes",
      @"fds" : @"nes", @"unf" : @"nes", @"unif" : @"nes", @"gb" : @"gb", @"dmg" : @"gb", @"sgb" : @"gb", @"gbc" : @"gbc",
    };
  });
  return map[ext] ?: unsupportedFolders()[ext];
}

static NSString *classifyFile(NSString *full, NSString *currentFolder) {
  NSString *name = full.lastPathComponent;
  NSString *ext = name.pathExtension.lowercaseString;
  if (isPortDataName(name)) return @"ports";
  if ([ext isEqualToString:@"zip"]) {
    if (isNeoGeoBios(full)) return @"arcade";
    if (zipHasPort(full)) return @"ports";
    // Contenido del zip (solo el índice): ROM de consola -> su carpeta (allí se descomprime sola)
    BOOL disc = NO, cueBin = NO;
    for (const std::string &entry : unpack::listZipEntries(full.UTF8String)) {
      NSString *e = [NSString stringWithUTF8String:entry.c_str()].pathExtension.lowercaseString;
      NSString *folder = folderForExtension(e);
      if (folder) return folder;
      if ([@[ @"iso", @"pbp" ] containsObject:e]) disc = YES;
      if ([@[ @"cue", @"bin", @"chd", @"img" ] containsObject:e]) cueBin = YES;
    }
    if (disc) return @"psp";   // ISO/PBP dentro de un zip: lo habitual es PSP
    if (cueBin) return @"ps1";
    // Romset arcade (nombres cortos de driver con .rom/.bin/etc. dentro)
    return [@[ @"arcade", @"fbneo" ] containsObject:currentFolder] ? currentFolder : @"arcade";
  }
  if ([ext isEqualToString:@"7z"]) return @".inbox";  // se descomprime y se reparte solo
  if ([ext isEqualToString:@"cue"]) {
    NSString *bin = cueReferencedBin(full);
    NSString *console = bin ? consoleForKind(sniffFile(bin)) : nil;
    return console ?: @"ps1";
  }
  if ([ext isEqualToString:@"chd"]) {
    if (chdKind(full) == romcheck::Kind::PSP) return @"psp";
    // CD: PS1, Saturn o Mega-CD; se respeta la carpeta si ya es una de ellas
    return [@[ @"ps1", @"saturn", @"sega" ] containsObject:currentFolder] ? currentFolder : @"ps1";
  }
  // Cabecera (magic bytes): .bin/.iso pueden ser Mega Drive, Mega-CD, Saturn, PS1 o PSP
  NSString *byContent = romcheck::isRomExtension(ext.UTF8String) ? consoleForKind(sniffFile(full)) : nil;
  if (byContent) return byContent;
  return folderForExtension(ext);
}

static NSString *folderLabel(NSString *folder) {
  static NSDictionary<NSString *, NSString *> *labels;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    labels = @{
      @"psp" : @"PSP", @"ps1" : @"PlayStation", @"n64" : @"Nintendo 64", @"gba" : @"Game Boy Advance",
      @"nds" : @"Nintendo DS", @"sega" : @"Sega", @"saturn" : @"Saturn", @"arcade" : @"Arcade",
      @"fbneo" : @"FBNeo", @".inbox" : @"Descomprimir y organizar", @"gb" : @"Game Boy",
      @"gbc" : @"Game Boy Color", @"nes" : @"NES", @"snes" : @"Super Nintendo", @"ports" : @"Ports",
    };
  });
  return labels[folder] ?: folder;
}

// Archivos que están fuera de su carpeta: raíz de Documents, Download(s)/Inbox y carpetas de
// consola equivocadas. Devuelve [{path, name, from, to, label, unsupported}].
static NSArray<NSDictionary *> *scanMisplaced(NSString *docs) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSMutableArray<NSDictionary *> *out = [NSMutableArray array];
  NSArray<NSString *> *scan = [@[ @"", @"Download", @"Downloads", @"Descargas", @"Inbox" ]
      arrayByAddingObjectsFromArray:@[
        @"psp", @"ps1", @"n64", @"gba", @"nds", @"sega", @"saturn", @"arcade", @"fbneo", @"snes", @"nes", @"gb", @"gbc"
      ]];
  NSMutableSet<NSString *> *tracks = [NSMutableSet set];
  for (NSString *dirName in scan) {
    NSString *dir = dirName.length ? [docs stringByAppendingPathComponent:dirName] : docs;
    for (NSString *name in [fm contentsOfDirectoryAtPath:dir error:nil]) {
      if ([name hasPrefix:@"."]) continue;
      NSString *full = [dir stringByAppendingPathComponent:name];
      BOOL isDir = NO;
      if (![fm fileExistsAtPath:full isDirectory:&isDir] || isDir) continue;
      if ([name.pathExtension.lowercaseString isEqualToString:@"cue"]) {
        for (NSString *t in cueReferencedFiles(full)) [tracks addObject:t];
      }
    }
  }
  for (NSString *dirName in scan) {
    NSString *dir = dirName.length ? [docs stringByAppendingPathComponent:dirName] : docs;
    const BOOL consoleDir = [unpackFolders() containsObject:dirName] || [@[ @"arcade", @"fbneo" ] containsObject:dirName];
    for (NSString *name in [fm contentsOfDirectoryAtPath:dir error:nil]) {
      if ([name hasPrefix:@"."]) continue;
      NSString *full = [dir stringByAppendingPathComponent:name];
      BOOL isDir = NO;
      if (![fm fileExistsAtPath:full isDirectory:&isDir] || isDir) continue;
      if ([tracks containsObject:full]) continue;  // las pistas viajan con su .cue
      NSString *ext = name.pathExtension.lowercaseString;
      // En una carpeta de consola, los .zip/.7z ya se descomprimen solos
      if (consoleDir && [unpackFolders() containsObject:dirName] && ([ext isEqualToString:@"zip"] || [ext isEqualToString:@"7z"])) continue;
      NSString *to = classifyFile(full, dirName);
      if (!to || [to isEqualToString:dirName] || isGameBoyPair(to, dirName)) continue;
      if ([to isEqualToString:@"arcade"] && [dirName isEqualToString:@"fbneo"]) continue;
      [out addObject:@{
        @"path" : full,
        @"name" : name,
        @"from" : dirName.length ? dirName : @"(raíz)",
        @"to" : to,
        @"label" : folderLabel(to),
        @"unsupported" : @(unsupportedFolders()[ext] != nil),
      }];
    }
  }
  return out;
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

    if (isPortDataName(name)) {
      moveIfFree(full, [[docs stringByAppendingPathComponent:@"ports"] stringByAppendingPathComponent:name]);
      continue;
    }
    if ([ext isEqualToString:@"zip"]) {
      if (zipHasPort(full)) {
        moveIfFree(full, [[docs stringByAppendingPathComponent:@"ports"] stringByAppendingPathComponent:name]);
        continue;
      }
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
      NSString *dir = sniffFile(full) == romcheck::Kind::PSP ? [docs stringByAppendingPathComponent:@"psp"] : ps1;
      moveIfFree(full, [dir stringByAppendingPathComponent:name]);
      continue;
    }
    if (!romcheck::isRomExtension(ext.UTF8String) || [ext isEqualToString:@"cue"]) continue;
    NSString *console = consoleForKind(sniffFile(full));
    if (console) {
      moveIfFree(full, [[docs stringByAppendingPathComponent:console] stringByAppendingPathComponent:name]);
    }
  }
}

// ---- Bloqueo de orientación (modo control vertical mientras se transmite a la TV) ----------
// La plantilla de React Native no implementa application:supportedInterfaceOrientationsForWindow:,
// así que se añade en tiempo de ejecución a la clase del AppDelegate y devuelve esta máscara.
static UIInterfaceOrientationMask g_orientationMask = UIInterfaceOrientationMaskAllButUpsideDown;
static BOOL g_orientationLocked = NO;  // hay un bloqueo activo (modo control de TV)
static NSString *g_orientationError = @"";

static UIInterfaceOrientationMask jlSupportedOrientations(id, SEL, UIApplication *, UIWindow *) {
  return g_orientationMask;
}

// Los view controllers (el de React Native y los que presente) también deben aceptar la máscara:
// iOS usa la intersección de la del AppDelegate y la del controlador visible.
@implementation UIViewController (JLOrientation)
- (UIInterfaceOrientationMask)jl_supportedInterfaceOrientations {
  if (g_orientationLocked) return g_orientationMask;
  return [self jl_supportedInterfaceOrientations];  // implementación original (intercambiada)
}
- (BOOL)jl_shouldAutorotate {
  if (g_orientationLocked) return YES;
  return [self jl_shouldAutorotate];
}
@end

static void installOrientationHook(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    Class cls = [UIApplication.sharedApplication.delegate class];
    SEL sel = @selector(application:supportedInterfaceOrientationsForWindow:);
    if (!cls) return;
    Method existing = class_getInstanceMethod(cls, sel);
    if (existing) {
      method_setImplementation(existing, (IMP)jlSupportedOrientations);
    } else {
      class_addMethod(cls, sel, (IMP)jlSupportedOrientations, "Q@:@@");
    }
    Class vc = UIViewController.class;
    method_exchangeImplementations(class_getInstanceMethod(vc, @selector(supportedInterfaceOrientations)),
                                   class_getInstanceMethod(vc, @selector(jl_supportedInterfaceOrientations)));
    method_exchangeImplementations(class_getInstanceMethod(vc, @selector(shouldAutorotate)),
                                   class_getInstanceMethod(vc, @selector(jl_shouldAutorotate)));
  });
}

static void applyOrientationMask(UIInterfaceOrientationMask mask) {
  installOrientationHook();
  g_orientationMask = mask;
  g_orientationLocked = mask != UIInterfaceOrientationMaskAllButUpsideDown;
  if (@available(iOS 16.0, *)) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (![scene isKindOfClass:UIWindowScene.class]) continue;
      UIWindowScene *ws = (UIWindowScene *)scene;
      if (ws.screen != UIScreen.mainScreen) continue;  // la ventana de la TV no gira
      for (UIWindow *w in ws.windows) {
        // El controlador raíz y cualquiera presentado encima
        for (UIViewController *vc = w.rootViewController; vc; vc = vc.presentedViewController) {
          [vc setNeedsUpdateOfSupportedInterfaceOrientations];
        }
      }
      UIWindowSceneGeometryPreferencesIOS *prefs =
          [[UIWindowSceneGeometryPreferencesIOS alloc] initWithInterfaceOrientations:mask];
      [ws requestGeometryUpdateWithPreferences:prefs
                                  errorHandler:^(NSError *error) {
                                    g_orientationError = error.localizedDescription ?: @"";
                                    NSLog(@"[RetroEmu] requestGeometryUpdate: %@", error);
                                  }];
    }
  } else {
    if (mask == UIInterfaceOrientationMaskPortrait) {
      [UIDevice.currentDevice setValue:@(UIInterfaceOrientationPortrait) forKey:@"orientation"];
    }
    [UIViewController attemptRotationToDeviceOrientation];
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
    dispatch_async(dispatch_get_main_queue(), ^{
      [[TVOutput shared] start];
    });
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
    @"ppsspp" : @"ppsspp_libretro",
    @"snes9x" : @"snes9x_libretro",
    @"fceumm" : @"fceumm_libretro",
    @"gambatte" : @"gambatte_libretro",
    @"prboom" : @"prboom_libretro",
    @"ecwolf" : @"ecwolf_libretro",
    @"tyrquake" : @"tyrquake_libretro",
    @"vitaquake2" : @"vitaquake2_libretro",
    @"nxengine" : @"nxengine_libretro",
    @"cannonball" : @"cannonball_libretro",
    @"reminiscence" : @"reminiscence_libretro",
    @"easyrpg" : @"easyrpg_libretro",
    @"scummvm" : @"scummvm_libretro",
  };
  NSString *name = frameworks[coreId];
  if (!name) return @NO;
  _coreId = coreId;
  NSString *path = [NSString stringWithFormat:@"%@/%@.framework/%@",
                                              NSBundle.mainBundle.privateFrameworksPath, name, name];
  NSFileManager *fileManager = NSFileManager.defaultManager;
  if (![fileManager fileExistsAtPath:path]) {
    _romError = [NSString stringWithFormat:@"El núcleo %@ no está incluido en esta compilación (no estaba disponible "
                                           @"en el servidor de libretro al generar el IPA).",
                                           name];
    return @NO;
  }
  // Archivos de sistema que viajan dentro del framework (prboom.wad, ecwolf.pk3, recursos de
  // Cannonball): se copian a Documents/system la primera vez
  NSString *bundledSystem = [path.stringByDeletingLastPathComponent stringByAppendingPathComponent:@"system"];
  for (NSString *item in [fileManager contentsOfDirectoryAtPath:bundledSystem error:nil]) {
    NSString *to = [_systemDir stringByAppendingPathComponent:item];
    if (![fileManager fileExistsAtPath:to]) {
      [fileManager copyItemAtPath:[bundledSystem stringByAppendingPathComponent:item] toPath:to error:nil];
    }
  }
  if ([coreId isEqualToString:@"ppsspp"]) {
    // PPSSPP necesita sus archivos de sistema (fuentes de la PSP, atlas de la interfaz) en
    // system/PPSSPP. Vienen dentro del framework; se copian la primera vez.
    NSFileManager *fm = NSFileManager.defaultManager;
    NSString *assets = [path.stringByDeletingLastPathComponent stringByAppendingPathComponent:@"PPSSPP"];
    NSString *dest = [_systemDir stringByAppendingPathComponent:@"PPSSPP"];
    if ([fm fileExistsAtPath:assets] && ![fm fileExistsAtPath:[dest stringByAppendingPathComponent:@"flash0"]]) {
      [fm createDirectoryAtPath:dest withIntermediateDirectories:YES attributes:nil error:nil];
      for (NSString *item in [fm contentsOfDirectoryAtPath:assets error:nil]) {
        NSString *to = [dest stringByAppendingPathComponent:item];
        if (![fm fileExistsAtPath:to]) {
          [fm copyItemAtPath:[assets stringByAppendingPathComponent:item] toPath:to error:nil];
        }
      }
    }
  }
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
  if (([_coreId isEqualToString:@"pcsx"] || [_coreId isEqualToString:@"yabause"]) &&
      sniffFile(path) == romcheck::Kind::PSP) {
    _romError = [NSString stringWithFormat:@"\"%@\" es un juego de PSP, no de PlayStation 1. Se ha movido "
                                           @"a la carpeta psp/ (pulsa Actualizar en la biblioteca).",
                                           path.lastPathComponent];
    relocatePspFromPs1(documentsDirectory());
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
    // Versiones modificadas (clones): el core lee los archivos comunes del romset original
    static NSDictionary<NSString *, NSString *> *parents = @{
      @"kf2k2mp" : @"kof2002", @"kf2k2mp2" : @"kof2002", @"kf2k2pls" : @"kof2002", @"kf2k2pla" : @"kof2002",
      @"kof2k2omg" : @"kof2002", @"kf2k3pl" : @"kof2003", @"kf2k3upl" : @"kof2003", @"kof98h" : @"kof98",
      @"kof98a" : @"kof98", @"kof97h" : @"kof97", @"kof97pls" : @"kof97", @"mslug3h" : @"mslug3",
      @"mslug3b6" : @"mslug3", @"mslug5h" : @"mslug5", @"ms5plus" : @"mslug5", @"mslugxh" : @"mslugx",
      @"garouh" : @"garou", @"samsho5h" : @"samsho5", @"rotdh" : @"rotd", @"kof2001h" : @"kof2001",
    };
    NSString *parent = parents[path.lastPathComponent.stringByDeletingPathExtension.lowercaseString];
    if (parent && ![fm fileExistsAtPath:[gameDir stringByAppendingPathComponent:[parent stringByAppendingString:@".zip"]]]) {
      _romError = [NSString stringWithFormat:
                                @"\"%@\" es una versión modificada de %@: el núcleo necesita también %@.zip (el "
                                @"juego original) en la misma carpeta %@/. Cópialo junto a él y vuelve a abrirlo.",
                                path.lastPathComponent, parent, parent, gameDir.lastPathComponent];
      return @NO;
    }
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

// Mueve una descarga comprimida a la bandeja; la biblioteca la descomprime al actualizar
- (NSString *)queueForUnpack:(NSString *)src {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *inbox = [documentsDirectory() stringByAppendingPathComponent:kInbox];
  [fm createDirectoryAtPath:inbox withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *dest = [inbox stringByAppendingPathComponent:src.lastPathComponent];
  NSError *error = nil;
  if (!moveIntoPlace(src, dest, &error)) {
    _romError = error.localizedDescription;
    return @"";
  }
  return dest;
}

// Comprimidos pendientes: los de las carpetas de consola y los de la bandeja (rutas relativas)
- (NSArray<NSString *> *)pendingArchives {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *docs = documentsDirectory();
  NSMutableArray<NSString *> *out = [NSMutableArray array];
  for (NSString *folder in [unpackFolders() arrayByAddingObject:kInbox]) {
    NSString *dir = [docs stringByAppendingPathComponent:folder];
    for (NSString *name in [fm contentsOfDirectoryAtPath:dir error:nil]) {
      if (isArchiveName(name)) [out addObject:[folder stringByAppendingPathComponent:name]];
    }
  }
  // .7z sueltos en la raíz de Documents (los .zip de la raíz son romsets arcade -> arcade/)
  for (NSString *name in [fm contentsOfDirectoryAtPath:docs error:nil]) {
    if (isArchiveName(name) && [name.pathExtension.lowercaseString isEqualToString:@"7z"]) [out addObject:name];
  }
  return out;
}

// Descomprime en segundo plano todos los pendientes. Cada juego queda en su carpeta y el
// comprimido se borra; si algo falla se conserva y se informa del motivo.
- (void)unpackArchives:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  static dispatch_queue_t queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    queue = dispatch_queue_create("retroemu.unpack", DISPATCH_QUEUE_SERIAL);
  });
  NSArray<NSString *> *pending = [self pendingArchives];
  dispatch_async(queue, ^{
    NSFileManager *fm = NSFileManager.defaultManager;
    NSString *docs = documentsDirectory();
    NSMutableArray<NSDictionary *> *results = [NSMutableArray array];
    // iOS no debe suspender la app a mitad de una ISO de 1,8 GB
    __block UIBackgroundTaskIdentifier task = UIBackgroundTaskInvalid;
    dispatch_sync(dispatch_get_main_queue(), ^{
      task = [UIApplication.sharedApplication beginBackgroundTaskWithName:@"unpack" expirationHandler:nil];
    });
    for (NSString *rel in pending) {
      NSString *full = [docs stringByAppendingPathComponent:rel];
      if (![fm fileExistsAtPath:full]) continue;
      NSString *folder = rel.pathComponents.firstObject;
      const BOOL inbox = [folder isEqualToString:kInbox];
      NSString *destDir = inbox ? docs : full.stringByDeletingLastPathComponent;
      const BOOL ports = [folder isEqualToString:@"ports"];
      if (ports) {
        destDir = [destDir stringByAppendingPathComponent:rel.lastPathComponent.stringByDeletingPathExtension];
        [fm createDirectoryAtPath:destDir withIntermediateDirectories:YES attributes:nil error:nil];
      }
      unpack::Result r = ports ? unpack::extractTree(full.UTF8String, destDir.UTF8String)
                               : unpack::extractAll(full.UTF8String, destDir.UTF8String);
      NSMutableArray<NSString *> *files = [NSMutableArray array];
      for (const std::string &f : r.files) [files addObject:[NSString stringWithUTF8String:f.c_str()]];
      // Un juego de otra consola dentro de una carpeta de consola: a su carpeta (salvo pistas de .cue)
      if (!inbox && !ports) {
        for (NSString *f in files) {
          NSString *ext = f.pathExtension.lowercaseString;
          if ([ext isEqualToString:@"cue"] || [ext isEqualToString:@"bin"]) continue;
          NSString *console = consoleForKind(sniffFile(f));
          if (console && ![console isEqualToString:folder] && !isGameBoyPair(console, folder)) {
            moveIfFree(f, [[docs stringByAppendingPathComponent:console] stringByAppendingPathComponent:f.lastPathComponent]);
          }
        }
      }
      const BOOL ok = r.error.empty() && !r.files.empty();
      if (ok) [fm removeItemAtPath:full error:nil];
      NSString *error = !r.error.empty() ? [NSString stringWithUTF8String:r.error.c_str()]
                        : r.files.empty() ? @"No contiene ningún juego" : @"";
      [results addObject:@{
        @"name" : rel.lastPathComponent,
        @"ok" : @(ok),
        @"files" : @(files.count),
        @"error" : error,
      }];
      NSLog(@"[RetroEmu] unpack %@ -> %lu archivos %@", rel, (unsigned long)files.count, error);
    }
    if (pending.count) {
      relocatePspFromPs1(docs);
      organizeDocumentsRoot(docs, romFolders(docs));
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      if (task != UIBackgroundTaskInvalid) [UIApplication.sharedApplication endBackgroundTask:task];
    });
    NSData *json = [NSJSONSerialization dataWithJSONObject:results options:0 error:nil];
    resolve(json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]");
  });
}

// ---- Juego en línea (lockstep entre dos iPhone con la misma app y el mismo juego) ----------
- (NSNumber *)netHost:(double)port {
  return @(host::netHost((int)port));
}

- (NSNumber *)netJoin:(NSString *)address port:(double)port {
  return @(host::netJoin(address.UTF8String, (int)port));
}

- (NSNumber *)netHostRelay:(NSString *)relayHost port:(double)port {
  return @(host::netHostRelay(relayHost.UTF8String, (int)port));
}

- (NSNumber *)netJoinCode:(NSString *)code relayHost:(NSString *)relayHost port:(double)port {
  return @(host::netJoinCode(code.uppercaseString.UTF8String, relayHost.UTF8String, (int)port));
}

// Mando web del Jugador 2 (navegador): sus pulsaciones llegan al puerto 1
- (NSNumber *)webPadStart:(NSString *)relayHost port:(double)port {
  return @(host::webPadStart(relayHost.UTF8String, (int)port));
}

- (void)webPadStop {
  host::webPadStop();
}

- (void)webPadKick:(double)port {
  host::webPadKick((int)port);
}

- (void)webPadReserve:(double)mask {
  host::webPadReserve((int)mask);
}

- (NSString *)webPadStatus {
  return [NSString stringWithUTF8String:host::webPadStatus().c_str()];
}

// ---- Organizador de archivos ----------------------------------------------------------------
- (NSString *)scanFiles {
  NSData *json = [NSJSONSerialization dataWithJSONObject:scanMisplaced(documentsDirectory()) options:0 error:nil];
  return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]";
}

// Mueve los archivos indicados (JSON [{path, to}]) a Documents/<to>/; un .cue arrastra sus pistas.
// Devuelve JSON {moved, failed}.
- (NSString *)organizeFiles:(NSString *)movesJson {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *docs = documentsDirectory();
  NSArray *moves = [NSJSONSerialization JSONObjectWithData:[movesJson dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  int moved = 0, failed = 0;
  for (NSDictionary *m in [moves isKindOfClass:NSArray.class] ? moves : @[]) {
    NSString *path = m[@"path"], *to = m[@"to"];
    if (![path isKindOfClass:NSString.class] || ![to isKindOfClass:NSString.class] || [to containsString:@".."]) continue;
    if (![path hasPrefix:docs] || ![fm fileExistsAtPath:path]) {
      ++failed;
      continue;
    }
    NSString *destDir = [docs stringByAppendingPathComponent:to];
    [fm createDirectoryAtPath:destDir withIntermediateDirectories:YES attributes:nil error:nil];
    NSArray<NSString *> *tracks = [path.pathExtension.lowercaseString isEqualToString:@"cue"] ? cueReferencedFiles(path) : @[];
    if (moveIfFree(path, [destDir stringByAppendingPathComponent:path.lastPathComponent])) {
      ++moved;
      for (NSString *t in tracks) moveIfFree(t, [destDir stringByAppendingPathComponent:t.lastPathComponent]);
    } else {
      ++failed;
    }
  }
  return [NSString stringWithFormat:@"{\"moved\":%d,\"failed\":%d}", moved, failed];
}

// Ruta del juego antes de cargar el núcleo (arcade: su carpeta es el system directory)
- (void)prepareContent:(NSString *)romPath {
  host::setContentPath(normalizeRomPath(romPath).UTF8String);
}

- (void)copyToClipboard:(NSString *)text {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIPasteboard.generalPasteboard.string = text;
  });
}

- (void)netStop {
  host::netStop();
}

- (NSString *)netStatus {
  return [NSString stringWithUTF8String:host::netStatus().c_str()];
}

- (NSString *)localAddress {
  return [NSString stringWithUTF8String:host::localAddress().c_str()];
}

- (NSDictionary *)gamepadInfo {
  return [[GamepadBridge sharedBridge] currentStatus];
}

// ---- Modo TV y mandos ---------------------------------------------------------------------
- (NSString *)tvStatus {
  NSData *json = [NSJSONSerialization dataWithJSONObject:[[TVOutput shared] status] options:0 error:nil];
  return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"{}";
}

- (void)setTVOptions:(BOOL)stretch smooth:(BOOL)smooth playing:(BOOL)playing {
  [[TVOutput shared] setStretch:stretch smooth:smooth playing:playing];
}

// Abre Fotos y guarda la imagen elegida (PNG) en destPath. Resuelve true si se guardó.
- (void)pickImage:(NSString *)destPath resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSString *docs = documentsDirectory();
  NSString *dest = normalizeRomPath(destPath);
  if (![dest hasPrefix:docs] || [dest containsString:@".."]) {
    resolve(@NO);
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *top = topViewController();
    if (!top || g_imagePicker) {
      resolve(@NO);
      return;
    }
    PHPickerConfiguration *config = [[PHPickerConfiguration alloc] init];
    config.filter = [PHPickerFilter imagesFilter];
    config.selectionLimit = 1;
    PHPickerViewController *picker = [[PHPickerViewController alloc] initWithConfiguration:config];
    picker.modalInPresentation = YES;  // se cierra con Cancelar: así siempre hay respuesta
    JLImagePicker *handler = [JLImagePicker new];
    handler.dest = dest;
    handler.done = ^(BOOL ok) {
      resolve(@(ok));
    };
    g_imagePicker = handler;
    picker.delegate = handler;
    [top presentViewController:picker animated:YES completion:nil];
  });
}

- (void)showAirPlayPicker {
  [[TVOutput shared] showRoutePicker];
}

// ---- Mandos físicos: mapeo, zona muerta, prueba de botones y búsqueda -----------------------
- (void)setPadMapping:(NSArray *)mapping {
  [[GamepadBridge sharedBridge] setMapping:mapping];
}

- (void)setPadOptions:(double)deadzone stickToDpad:(BOOL)stickToDpad {
  [[GamepadBridge sharedBridge] setDeadzone:(float)deadzone stickToDpad:stickToDpad];
}

- (NSString *)gamepadInput {
  NSData *json = [NSJSONSerialization dataWithJSONObject:[[GamepadBridge sharedBridge] physicalState:0] options:0 error:nil];
  return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"{}";
}

- (void)discoverControllers {
  [[GamepadBridge sharedBridge] discover];
}

- (void)setOrientationLock:(BOOL)portrait {
  dispatch_async(dispatch_get_main_queue(), ^{
    applyOrientationMask(portrait ? UIInterfaceOrientationMaskPortrait : UIInterfaceOrientationMaskAllButUpsideDown);
  });
}

// 'portrait' | 'landscape' | 'auto' (gira libremente) | cualquier otro = normal
- (void)setOrientationMode:(NSString *)mode {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIInterfaceOrientationMask mask = UIInterfaceOrientationMaskAllButUpsideDown;
    if ([mode isEqualToString:@"portrait"]) mask = UIInterfaceOrientationMaskPortrait;
    if ([mode isEqualToString:@"landscape"]) mask = UIInterfaceOrientationMaskLandscape;
    applyOrientationMask(mask);
  });
}

- (void)swapPlayers {
  [[GamepadBridge sharedBridge] swapPlayers];
}

// Vibración háptica breve al pulsar un botón del pad (Taptic Engine)
- (void)haptic:(double)strength {
  dispatch_async(dispatch_get_main_queue(), ^{
    static UIImpactFeedbackGenerator *light;
    static UIImpactFeedbackGenerator *medium;
    if (!light) {
      light = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleLight];
      medium = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleMedium];
    }
    UIImpactFeedbackGenerator *g = strength > 0.6 ? medium : light;
    [g impactOccurred];
    [g prepare];
  });
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

- (void)setLook:(double)x y:(double)y {
  host::setLook(x, y);
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
  installBundledPorts(docs);
  organizeDocumentsRoot(docs, folders);
  relocatePspFromPs1(docs);
  relocateFromArcade(docs);

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
    if ([top isEqualToString:kInbox]) {
      [en skipDescendants];  // descargas pendientes de descomprimir
      continue;
    }
    if ([rel.lastPathComponent hasPrefix:@"."]) continue;  // extracciones a medias (.part)
    NSString *ext = rel.pathExtension.lowercaseString;
    NSString *full = [docs stringByAppendingPathComponent:rel];
    if (([ext isEqualToString:@"zip"] || [ext isEqualToString:@"7z"]) &&
        [unpackFolders() containsObject:top] && rel.pathComponents.count == 2) {
      continue;  // se descomprime en segundo plano (unpackArchives)
    }
    if ([top isEqualToString:@"ports"]) {
      // ports/: solo el archivo de arranque de cada juego (el resto son sus datos)
      if (portCoreFor(full)) [roms addObject:full];
      continue;
    }
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
    // Más de 64 MB: casi seguro una imagen de disco (PSP/PS1/Saturn). No se carga en memoria:
    // se descomprime en streaming en segundo plano
    if (fileSizeAt(src) > (64ull << 20)) return [self queueForUnpack:src];
    std::string extracted = romzip::extractRom(src.UTF8String, folders);
    if (!extracted.empty()) {
      [fm removeItemAtPath:src error:nil];
      return [NSString stringWithUTF8String:extracted.c_str()];
    }
    std::string foreign = romzip::foreignEntry(src.UTF8String);
    const std::string foreignExt = foreign.substr(foreign.find_last_of('.') + 1);
    for (const char *disc : {"iso", "cso", "chd", "pbp", "cue", "bin"}) {
      if (!foreign.empty() && strcasecmp(foreignExt.c_str(), disc) == 0) return [self queueForUnpack:src];
    }
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
    if (!unpack::is7z(src.UTF8String)) {
      _romError = [NSString stringWithFormat:@"\"%@\" no es un .7z válido (la descarga pudo fallar)", name];
      return @"";
    }
    return [self queueForUnpack:src];
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
  if (portCoreFor(path)) return @"ports";
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
    const romcheck::Kind kind = sniffFile(path);
    if (kind == romcheck::Kind::PSP) return @"psp";
    if (kind != romcheck::Kind::PS1) return @"";
    if (isInDocsFolder(path, @"sega")) return @"sega";  // Mega-CD
    return isInDocsFolder(path, @"saturn") ? @"saturn" : @"ps1";
  }
  NSString *console = consoleForKind(sniffFile(path));
  // Game Boy y Game Boy Color comparten núcleo: se respeta la carpeta elegida por el usuario
  if ([console isEqualToString:@"gb"] && isInDocsFolder(path, @"gbc")) return @"gbc";
  if ([console isEqualToString:@"gbc"] && isInDocsFolder(path, @"gb")) return @"gb";
  return console ?: @"";
}

@end
