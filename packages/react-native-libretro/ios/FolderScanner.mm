#import "FolderScanner.h"

#import <CommonCrypto/CommonDigest.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <cstdio>
#include <set>
#include <string>
#include <vector>

#include "RomIdentify.hpp"
#include "RomInspector.hpp"
#include "Unpack.hpp"

// ---- Bookmark de la carpeta vinculada ----------------------------------------------------------
static NSString *const kBookmarkKey = @"jl.scanFolder.bookmark.v1";
static NSString *const kFolderNameKey = @"jl.scanFolder.name.v1";
// Archivos ya importados (ruta relativa + tamaño): no se vuelven a copiar en cada sincronización
static NSString *const kManifestName = @"system/.jl-folder-imports.json";

static NSURL *resolveBookmarkKey(NSString *key) {
  NSData *data = [NSUserDefaults.standardUserDefaults dataForKey:key];
  if (!data) return nil;
  BOOL stale = NO;
  NSError *error = nil;
  NSURL *url = [NSURL URLByResolvingBookmarkData:data options:0 relativeToURL:nil bookmarkDataIsStale:&stale error:&error];
  if (url && stale && [url startAccessingSecurityScopedResource]) {
    NSData *fresh = [url bookmarkDataWithOptions:0 includingResourceValuesForKeys:nil relativeToURL:nil error:nil];
    if (fresh) [NSUserDefaults.standardUserDefaults setObject:fresh forKey:key];
    [url stopAccessingSecurityScopedResource];
  }
  return url;
}

static NSURL *resolveLinkedFolder(void) { return resolveBookmarkKey(kBookmarkKey); }

@interface JLFolderPickerDelegate : NSObject <UIDocumentPickerDelegate>
@property(nonatomic, copy) void (^done)(NSURL *_Nullable url);
@end
static JLFolderPickerDelegate *g_folderPicker;  // vivo mientras el selector está abierto
@implementation JLFolderPickerDelegate
- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  void (^cb)(NSURL *) = self.done;
  g_folderPicker = nil;
  cb(urls.firstObject);
}
- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
  void (^cb)(NSURL *) = self.done;
  g_folderPicker = nil;
  cb(nil);
}
@end

static UIViewController *scannerTopViewController(void) {
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

// ---- Progreso ------------------------------------------------------------------------------------
static NSDictionary *g_status = @{@"busy" : @NO};
static void setStatus(NSString *phase, NSString *current, NSUInteger done, NSUInteger total) {
  @synchronized(JLFolderScanner.class) {
    g_status = @{@"busy" : @YES, @"phase" : phase, @"current" : current ?: @"", @"done" : @(done), @"total" : @(total)};
  }
}
static void clearStatus(void) {
  @synchronized(JLFolderScanner.class) {
    g_status = @{@"busy" : @NO};
  }
}

static NSString *toJSON(id obj) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:obj options:0 error:nil];
  return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"{}";
}

// ---- BIOS conocidas ------------------------------------------------------------------------------
struct KnownBios {
  const char *file;  // destino relativo a system/ (nombre que esperan los núcleos)
  const char *md5;   // versión buena documentada por libretro ("" = cualquiera)
  unsigned long long size;
};
static const KnownBios kKnownBios[] = {
    {"scph5501.bin", "490f666e1afb15b7362b406ed1cea246", 524288},
    {"scph5500.bin", "8dd7d5296a650fac7319bce665a6a53c", 524288},
    {"scph5502.bin", "32736f17079d0b2b7024407c39bd3050", 524288},
    {"scph1001.bin", "924e392ed05558ffdb115408c263dccf", 524288},
    {"scph7001.bin", "1e68c231d0896b7eadcad1d7d8e76129", 524288},
    {"bios_CD_U.bin", "2efd74e3232ff260e371b99f84024f7f", 131072},
    {"bios_CD_E.bin", "e66fa1dc5820d254611fdcdba0662372", 131072},
    {"bios_CD_J.bin", "278a9397d192149e84e820ac621a8edd", 131072},
    {"dc/dc_boot.bin", "e10c53c2f8b90bab96ead2d368858623", 2097152},
    {"dc/dc_flash.bin", "0a93f7940c455905bea6e392dfde92a4", 131072},
    {"bios7.bin", "df692a80a5b1bc90728bc3dfc76cd948", 16384},
    {"bios9.bin", "a392174eb3e572fed6447e956bde4b25", 4096},
    {"saturn_bios.bin", "af5828fdff51384f99b3c4926be27762", 524288},
    {"gba_bios.bin", "a860e8c0b6d573d191e4ec7db1b1e4f6", 16384},
};

static NSString *md5OfFile(NSString *path) {
  FILE *f = std::fopen(path.fileSystemRepresentation, "rb");
  if (!f) return nil;
  CC_MD5_CTX ctx;
  CC_MD5_Init(&ctx);
  std::vector<uint8_t> buf(1 << 18);
  size_t n;
  while ((n = std::fread(buf.data(), 1, buf.size(), f)) > 0) CC_MD5_Update(&ctx, buf.data(), CC_LONG(n));
  std::fclose(f);
  unsigned char d[CC_MD5_DIGEST_LENGTH];
  CC_MD5_Final(d, &ctx);
  NSMutableString *hex = [NSMutableString string];
  for (int i = 0; i < CC_MD5_DIGEST_LENGTH; ++i) [hex appendFormat:@"%02x", d[i]];
  return hex;
}

// BIOS por nombre (sin leer el archivo): ruta relativa a Documents o nil
static NSString *biosByName(NSString *name) {
  NSString *lower = name.lowercaseString;
  if ([lower isEqualToString:@"neogeo.zip"]) return @"system/neogeo.zip";
  if ([@[ @"dc_boot.bin", @"dc_flash.bin" ] containsObject:lower]) return [@"system/dc" stringByAppendingPathComponent:lower];
  for (const KnownBios &b : kKnownBios) {
    NSString *file = [NSString stringWithUTF8String:b.file];
    if ([file.lastPathComponent.lowercaseString isEqualToString:lower]) return [@"system" stringByAppendingPathComponent:file];
  }
  if (([lower hasPrefix:@"scph"] && [lower.pathExtension isEqualToString:@"bin"]) || [lower hasPrefix:@"bios_cd_"] ||
      [lower isEqualToString:@"firmware.bin"]) {
    return [@"system" stringByAppendingPathComponent:name];
  }
  return nil;
}

// BIOS por MD5 (solo archivos con el tamaño exacto de una BIOS conocida): ruta relativa o nil
static NSString *biosByHash(NSString *path, unsigned long long size) {
  BOOL candidate = NO;
  for (const KnownBios &b : kKnownBios) candidate = candidate || b.size == size;
  if (!candidate) return nil;
  NSString *sum = md5OfFile(path);
  if (!sum) return nil;
  for (const KnownBios &b : kKnownBios) {
    if (b.size == size && [sum isEqualToString:[NSString stringWithUTF8String:b.md5]]) {
      return [@"system" stringByAppendingPathComponent:[NSString stringWithUTF8String:b.file]];
    }
  }
  return nil;
}

// ---- Clasificación -------------------------------------------------------------------------------
static NSString *consoleLabel(NSString *folder) {
  static NSDictionary<NSString *, NSString *> *labels;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    labels = @{
      @"psp" : @"PSP", @"ps1" : @"PlayStation", @"n64" : @"Nintendo 64", @"gba" : @"Game Boy Advance",
      @"nds" : @"Nintendo DS", @"sega" : @"Sega (Mega Drive / Mega-CD / Master System)", @"saturn" : @"Sega Saturn",
      @"arcade" : @"Arcade (MAME / FBNeo)", @"fbneo" : @"FBNeo", @"gb" : @"Game Boy", @"gbc" : @"Game Boy Color",
      @"nes" : @"NES", @"snes" : @"Super Nintendo", @"ports" : @"Ports PC", @"dreamcast" : @"Dreamcast",
      @"system" : @"BIOS (system/)", @".inbox" : @"Varios (se descomprime y reparte solo)",
    };
  });
  return labels[folder] ?: folder;
}

static BOOL isDiscExt(NSString *ext) { return [@[ @"iso", @"bin", @"img" ] containsObject:ext]; }

static BOOL isGameExt(NSString *ext) {
  return romcheck::isRomExtension(ext.UTF8String) || [@[ @"zip", @"7z", @"pbp", @"cso", @"chd", @"img", @"wad", @"m3u" ] containsObject:ext];
}

// Datos de port (Doom, Quake, Cave Story…) dentro de un comprimido
static BOOL isPortEntry(NSString *entry) {
  NSString *name = entry.lastPathComponent.lowercaseString;
  NSString *ext = name.pathExtension;
  return [ext isEqualToString:@"wad"] || [name isEqualToString:@"pak0.pak"] || [name isEqualToString:@"doukutsu.exe"] ||
         [name hasPrefix:@"vswap."] || [name isEqualToString:@"rpg_rt.ldb"] || [name isEqualToString:@"level1.map"];
}

// Partes típicas de un romset de Neo-Geo ("201-p1.p1", "kf2k-c1.c1", "063-s1.s1"…)
static BOOL isNeoGeoPart(NSString *entry) {
  static NSRegularExpression *re;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    re = [NSRegularExpression regularExpressionWithPattern:@"-[pcsmv]\\d+\\.[pcsmv]\\d+$" options:NSRegularExpressionCaseInsensitive error:nil];
  });
  return [re firstMatchInString:entry options:0 range:NSMakeRange(0, entry.length)] != nil;
}

// Bytes de cabecera que se descomprimen de cada entrada de un comprimido
static size_t headBytesFor(const std::string &name) {
  NSString *ext = [NSString stringWithUTF8String:name.c_str()].pathExtension.lowercaseString;
  if (isDiscExt(ext)) return 512 * 1024;  // ISO 9660: directorio raíz y SYSTEM.CNF / UMD_DATA.BIN
  if ([ext isEqualToString:@"pbp"]) return 64 * 1024;
  if ([ext isEqualToString:@"chd"]) return 4096;
  if (romcheck::isRomExtension(ext.UTF8String)) return 128 * 1024;  // SNES HiROM: 0xFFC0 (+512)
  return 0;
}

static romid::Info identifyPath(NSString *path) {
  FILE *f = std::fopen(path.fileSystemRepresentation, "rb");
  if (!f) return {};
  std::fseek(f, 0, SEEK_END);
  const long long size = ftello(f);
  const std::string ext = path.pathExtension.lowercaseString.UTF8String;
  romid::Info info = romid::identify(ext, romid::fileReader(f), uint64_t(size > 0 ? size : 0));
  std::fclose(f);
  return info;
}

// Pistas de una hoja .cue / .gdi (nombres de archivo, en el mismo directorio)
static NSArray<NSString *> *sheetTrackNames(NSString *sheet) {
  NSString *text = [NSString stringWithContentsOfFile:sheet encoding:NSUTF8StringEncoding error:nil]
                       ?: [NSString stringWithContentsOfFile:sheet encoding:NSISOLatin1StringEncoding error:nil];
  if (!text) return @[];
  const BOOL gdi = [sheet.pathExtension.lowercaseString isEqualToString:@"gdi"];
  NSMutableArray<NSString *> *out = [NSMutableArray array];
  for (NSString *raw in [text componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
    NSString *line = [raw stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    NSString *file = nil;
    if (!gdi && ![line.uppercaseString hasPrefix:@"FILE "]) continue;
    const NSRange q = [line rangeOfString:@"\""];
    if (q.location != NSNotFound) {
      const NSRange q2 = [line rangeOfString:@"\"" options:0 range:NSMakeRange(q.location + 1, line.length - q.location - 1)];
      if (q2.location != NSNotFound) file = [line substringWithRange:NSMakeRange(q.location + 1, q2.location - q.location - 1)];
    } else {
      NSArray<NSString *> *parts = [[line componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceCharacterSet]
          filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]];
      if (gdi && parts.count >= 6) file = parts[4];
      if (!gdi && parts.count >= 2) file = parts[1];
    }
    if (file.length) [out addObject:file.lastPathComponent];
  }
  return out;
}

// Un elemento del plan: {rel, name, size, kind, console, label, serial, title, detail, files, destName, already}
static NSMutableDictionary *makeItem(NSString *rel, NSString *name, unsigned long long size, NSString *kind, NSString *console) {
  return [@{
    @"rel" : rel, @"name" : name, @"size" : @(size), @"kind" : kind, @"console" : console ?: @"",
    @"label" : console.length ? consoleLabel(console) : @"No reconocido", @"serial" : @"", @"title" : @"", @"detail" : @"",
    @"files" : @[ rel ], @"destName" : name, @"already" : @NO,
  } mutableCopy];
}

static void classifyArchive(NSString *full, NSString *parentName, NSMutableDictionary *item) {
  std::vector<unpack::PeekEntry> entries;
  std::string error;
  if (!unpack::peekArchive(full.fileSystemRepresentation, headBytesFor, entries, error)) {
    item[@"kind"] = @"unknown";
    item[@"label"] = @"No reconocido";
    item[@"detail"] = [NSString stringWithUTF8String:error.c_str()];
    return;
  }
  const BOOL sevenZip = unpack::is7z(full.fileSystemRepresentation);
  NSMutableOrderedSet<NSString *> *consoles = [NSMutableOrderedSet orderedSet];
  NSUInteger bios = 0, ports = 0, neoParts = 0, unknownDiscs = 0, roms = 0;
  NSString *serial = @"", *title = @"";
  for (const unpack::PeekEntry &e : entries) {
    NSString *name = [NSString stringWithUTF8String:e.name.c_str()] ?: @"";
    NSString *ext = name.pathExtension.lowercaseString;
    if (biosByName(name.lastPathComponent)) {
      ++bios;
      continue;
    }
    if (isPortEntry(name)) {
      ++ports;
      continue;
    }
    if (isNeoGeoPart(name)) ++neoParts;
    if ([@[ @"cue", @"gdi", @"m3u" ] containsObject:ext]) {
      if ([ext isEqualToString:@"gdi"]) [consoles addObject:@"dreamcast"];
      continue;
    }
    const BOOL romExt = romcheck::isRomExtension(ext.UTF8String) || [@[ @"pbp", @"cso", @"img" ] containsObject:ext];
    if (!romExt || e.head.empty()) continue;
    const romid::Info info = romid::identify(ext.UTF8String, romid::bufferReader(e.head.data(), e.head.size()), e.size);
    if (info.console.empty()) {
      if (isDiscExt(ext)) ++unknownDiscs;
      continue;
    }
    ++roms;
    [consoles addObject:[NSString stringWithUTF8String:info.console.c_str()]];
    if (!serial.length && !info.serial.empty()) serial = [NSString stringWithUTF8String:info.serial.c_str()] ?: @"";
    if (!title.length && !info.title.empty()) title = [NSString stringWithUTF8String:info.title.c_str()] ?: @"";
  }
  // gb/gbc comparten núcleo: una sola carpeta
  if ([consoles containsObject:@"gb"] && [consoles containsObject:@"gbc"]) [consoles removeObject:@"gb"];

  NSString *dest = nil, *kind = @"archive", *detail = nil;
  if (ports) {
    dest = @"ports";
    detail = @"Datos de un port (Doom, Quake, Cave Story…)";
  } else if (consoles.count == 1) {
    dest = consoles.firstObject;
    detail = [NSString stringWithFormat:@"%lu juego%@ dentro, se descomprime solo en %@/", (unsigned long)MAX(roms, 1),
                                        roms == 1 || roms == 0 ? @"" : @"s", dest];
  } else if (consoles.count > 1 || unknownDiscs) {
    dest = @".inbox";
    detail = consoles.count > 1 ? @"Juegos de varias consolas: se descomprime y cada uno va a su carpeta"
                                : @"Imagen de disco sin cabecera reconocible: se descomprime y se organiza";
  } else if (bios) {
    dest = @".inbox";
    kind = @"bios";
    detail = [NSString stringWithFormat:@"%lu BIOS dentro: se descomprimen a system/", (unsigned long)bios];
  } else if (sevenZip) {
    kind = @"unknown";
    detail = @"Romset arcade en .7z: FBNeo y MAME leen los romsets en .zip. Vuelve a comprimirlo como .zip";
  } else if (entries.empty()) {
    kind = @"unknown";
    detail = @"Comprimido vacío";
  } else {
    // Sin ROM de consola dentro: romset arcade (MAME 2003-Plus / FBNeo lo leen comprimido)
    dest = [parentName.lowercaseString isEqualToString:@"fbneo"] ? @"fbneo" : @"arcade";
    kind = @"game";
    detail = neoParts ? @"Romset de Neo-Geo (necesita neogeo.zip en system/)" : @"Romset arcade (se abre comprimido)";
  }
  item[@"kind"] = dest ? kind : @"unknown";
  item[@"console"] = dest ?: @"";
  item[@"label"] = dest ? consoleLabel(dest) : @"No reconocido";
  item[@"serial"] = serial;
  item[@"title"] = title;
  item[@"detail"] = detail ?: @"";
}

// ---- Recorrido de la carpeta ---------------------------------------------------------------------
static NSMutableDictionary *loadManifest(NSString *docs) {
  NSData *data = [NSData dataWithContentsOfFile:[docs stringByAppendingPathComponent:kManifestName]];
  NSDictionary *m = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  return [m isKindOfClass:NSDictionary.class] ? [m mutableCopy] : [NSMutableDictionary dictionary];
}
static void saveManifest(NSString *docs, NSDictionary *m) {
  NSString *path = [docs stringByAppendingPathComponent:kManifestName];
  [NSFileManager.defaultManager createDirectoryAtPath:path.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
  [[NSJSONSerialization dataWithJSONObject:m options:0 error:nil] writeToFile:path atomically:YES];
}
static NSString *manifestKey(NSDictionary *item) { return [NSString stringWithFormat:@"%@|%@", item[@"rel"], item[@"size"]]; }

// Analiza la carpeta (con el acceso de seguridad ya abierto). Devuelve items + resumen.
static NSDictionary *analyzeFolder(NSURL *root, NSString *docs) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *rootPath = root.path.stringByStandardizingPath;
  NSArray<NSURLResourceKey> *keys = @[ NSURLIsDirectoryKey, NSURLFileSizeKey, NSURLUbiquitousItemDownloadingStatusKey ];
  NSDirectoryEnumerator<NSURL *> *en = [fm enumeratorAtURL:root
                                includingPropertiesForKeys:keys
                                                   options:0
                                              errorHandler:^BOOL(NSURL *url, NSError *error) {
                                                return YES;
                                              }];
  struct FileRef {
    NSString *path;
    NSString *rel;
    unsigned long long size;
  };
  std::vector<FileRef> files;
  NSUInteger icloud = 0;
  for (NSURL *url in en) {
    NSString *name = url.lastPathComponent;
    NSNumber *isDir = nil;
    [url getResourceValue:&isDir forKey:NSURLIsDirectoryKey error:nil];
    if (isDir.boolValue) {
      if ([name hasPrefix:@"."] || [name isEqualToString:@"__MACOSX"] || en.level > 4) [en skipDescendants];
      continue;
    }
    // iCloud sin descargar: marcador ".Juego.zip.icloud" o estado de descarga distinto de "actual"
    if ([name hasPrefix:@"."] && [name.pathExtension isEqualToString:@"icloud"]) {
      NSString *real = [[name substringFromIndex:1] stringByDeletingPathExtension];
      if (isGameExt(real.pathExtension.lowercaseString)) {
        ++icloud;
        [fm startDownloadingUbiquitousItemAtURL:[url.URLByDeletingLastPathComponent URLByAppendingPathComponent:real] error:nil];
      }
      continue;
    }
    if ([name hasPrefix:@"."]) continue;
    NSString *ext = name.pathExtension.lowercaseString;
    if (!isGameExt(ext) && ![@[ @"cue", @"gdi" ] containsObject:ext]) continue;
    NSString *dl = nil;
    [url getResourceValue:&dl forKey:NSURLUbiquitousItemDownloadingStatusKey error:nil];
    if (dl && ![dl isEqualToString:NSURLUbiquitousItemDownloadingStatusCurrent]) {
      ++icloud;
      [fm startDownloadingUbiquitousItemAtURL:url error:nil];
      continue;
    }
    NSNumber *size = nil;
    [url getResourceValue:&size forKey:NSURLFileSizeKey error:nil];
    NSString *path = url.path.stringByStandardizingPath;
    NSString *rel = [path hasPrefix:rootPath] ? [path substringFromIndex:MIN(path.length, rootPath.length + 1)] : name;
    files.push_back({path, rel, size.unsignedLongLongValue});
    if (files.size() >= 5000) break;
  }

  // Pistas que arrastra cada hoja .cue/.gdi (no se listan por separado)
  NSMutableSet<NSString *> *tracks = [NSMutableSet set];
  for (const FileRef &f : files) {
    NSString *ext = f.path.pathExtension.lowercaseString;
    if (![ext isEqualToString:@"cue"] && ![ext isEqualToString:@"gdi"]) continue;
    for (NSString *t in sheetTrackNames(f.path)) {
      [tracks addObject:[f.path.stringByDeletingLastPathComponent stringByAppendingPathComponent:t].stringByStandardizingPath];
    }
  }

  NSDictionary *manifest = loadManifest(docs);
  NSMutableArray<NSMutableDictionary *> *items = [NSMutableArray array];
  NSUInteger index = 0;
  for (const FileRef &f : files) {
    ++index;
    if ([tracks containsObject:f.path]) continue;
    NSString *name = f.path.lastPathComponent;
    NSString *ext = name.pathExtension.lowercaseString;
    NSString *parent = f.path.stringByDeletingLastPathComponent.lastPathComponent;
    setStatus(@"analyze", name, index, files.size());
    NSMutableDictionary *item = makeItem(f.rel, name, f.size, @"game", nil);

    NSString *bios = biosByName(name) ?: ([ext isEqualToString:@"zip"] ? nil : biosByHash(f.path, f.size));
    if (bios) {
      item[@"kind"] = @"bios";
      item[@"console"] = @"system";
      item[@"label"] = consoleLabel(@"system");
      item[@"destName"] = [bios substringFromIndex:@"system/".length];  // "dc/dc_boot.bin", "scph5501.bin"…
      item[@"detail"] = [bios.lastPathComponent isEqualToString:name] ? @"BIOS reconocida por nombre"
                                                                       : [NSString stringWithFormat:@"BIOS reconocida por MD5 → %@", bios.lastPathComponent];
    } else if ([ext isEqualToString:@"zip"] || [ext isEqualToString:@"7z"]) {
      classifyArchive(f.path, parent, item);
    } else if ([ext isEqualToString:@"cue"] || [ext isEqualToString:@"gdi"]) {
      NSArray<NSString *> *names = sheetTrackNames(f.path);
      NSString *dir = f.path.stringByDeletingLastPathComponent;
      NSString *relDir = f.rel.stringByDeletingLastPathComponent;
      NSMutableArray<NSString *> *rels = [NSMutableArray arrayWithObject:f.rel];
      for (NSString *t in names) {
        if ([fm fileExistsAtPath:[dir stringByAppendingPathComponent:t]]) [rels addObject:[relDir stringByAppendingPathComponent:t]];
      }
      item[@"files"] = rels;
      NSString *console = @"dreamcast";
      if ([ext isEqualToString:@"cue"]) {
        const romid::Info info = names.count ? identifyPath([dir stringByAppendingPathComponent:names.firstObject]) : romid::Info{};
        console = info.console.empty() ? @"ps1" : [NSString stringWithUTF8String:info.console.c_str()];
        item[@"serial"] = [NSString stringWithUTF8String:info.serial.c_str()] ?: @"";
        item[@"title"] = [NSString stringWithUTF8String:info.title.c_str()] ?: @"";
      }
      item[@"console"] = console;
      item[@"label"] = consoleLabel(console);
      item[@"detail"] = [NSString stringWithFormat:@"Hoja %@ + %lu pista%@", ext, (unsigned long)(rels.count - 1), rels.count == 2 ? @"" : @"s"];
    } else if ([ext isEqualToString:@"wad"]) {
      item[@"console"] = @"ports";
      item[@"label"] = consoleLabel(@"ports");
      item[@"detail"] = @"Doom / Heretic / Hexen (PrBoom)";
    } else {
      const romid::Info info = identifyPath(f.path);
      if (info.console.empty()) {
        item[@"kind"] = @"unknown";
        item[@"detail"] = @"Cabecera no reconocida para ninguna consola soportada";
      } else {
        NSString *console = [NSString stringWithUTF8String:info.console.c_str()];
        // CHD de CD: si su carpeta de origen dice Saturn o Sega se respeta
        if ([ext isEqualToString:@"chd"] && [console isEqualToString:@"ps1"] &&
            [@[ @"saturn", @"sega" ] containsObject:parent.lowercaseString]) {
          console = parent.lowercaseString;
        }
        item[@"console"] = console;
        item[@"label"] = consoleLabel(console);
        item[@"serial"] = [NSString stringWithUTF8String:info.serial.c_str()] ?: @"";
        item[@"title"] = [NSString stringWithUTF8String:info.title.c_str()] ?: @"";
        item[@"detail"] = @"Reconocido por cabecera";
      }
    }
    // Ya importado antes (o ya existe en su carpeta)
    NSString *console = item[@"console"];
    NSString *dest = [[docs stringByAppendingPathComponent:console] stringByAppendingPathComponent:item[@"destName"]];
    const BOOL exists = console.length && ![console isEqualToString:@".inbox"] && [NSFileManager.defaultManager fileExistsAtPath:dest];
    item[@"already"] = @(manifest[manifestKey(item)] != nil || exists);
    [items addObject:item];
  }

  NSMutableDictionary<NSString *, NSNumber *> *games = [NSMutableDictionary dictionary];
  NSUInteger biosCount = 0, archives = 0, unknown = 0, already = 0;
  for (NSDictionary *item in items) {
    if ([item[@"already"] boolValue]) {
      ++already;
      continue;
    }
    NSString *kind = item[@"kind"];
    if ([kind isEqualToString:@"unknown"]) ++unknown;
    else if ([kind isEqualToString:@"bios"]) ++biosCount;
    else {
      if ([kind isEqualToString:@"archive"]) ++archives;
      NSString *c = item[@"console"];
      games[c] = @(games[c].unsignedIntegerValue + 1);
    }
  }
  return @{
    @"items" : items,
    @"summary" : @{
      @"games" : games, @"bios" : @(biosCount), @"archives" : @(archives), @"unknown" : @(unknown),
      @"icloud" : @(icloud), @"already" : @(already), @"total" : @(items.count),
    },
  };
}

// Copia con coordinación de archivos (iCloud Drive / proveedores de Archivos) a ".nombre.part" y
// renombra al terminar. Nunca sobrescribe.
static BOOL copyCoordinated(NSURL *src, NSString *dest, NSString **error) {
  NSFileManager *fm = NSFileManager.defaultManager;
  if ([fm fileExistsAtPath:dest]) return YES;
  [fm createDirectoryAtPath:dest.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *part = [dest.stringByDeletingLastPathComponent
      stringByAppendingPathComponent:[NSString stringWithFormat:@".%@.part", dest.lastPathComponent]];
  [fm removeItemAtPath:part error:nil];
  __block BOOL ok = NO;
  __block NSError *copyError = nil;
  NSError *coordError = nil;
  NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
  [coordinator coordinateReadingItemAtURL:src
                                  options:NSFileCoordinatorReadingWithoutChanges
                                    error:&coordError
                               byAccessor:^(NSURL *readURL) {
                                 ok = [fm copyItemAtURL:readURL toURL:[NSURL fileURLWithPath:part] error:&copyError];
                               }];
  if (ok) ok = [fm moveItemAtPath:part toPath:dest error:&copyError];
  if (!ok) {
    [fm removeItemAtPath:part error:nil];
    if (error) *error = (copyError ?: coordError).localizedDescription ?: @"No se pudo copiar";
  }
  return ok;
}

@implementation JLFolderScanner

+ (void)pickFolderWithCompletion:(void (^)(NSString *_Nullable, NSString *_Nullable))completion {
  [self pickFolderStoringBookmark:kBookmarkKey name:kFolderNameKey completion:completion];
}

+ (nullable NSURL *)resolveBookmark:(NSString *)bookmarkKey {
  return resolveBookmarkKey(bookmarkKey);
}

+ (void)pickFolderStoringBookmark:(NSString *)bookmarkKey
                             name:(NSString *)nameKey
                       completion:(void (^)(NSString *_Nullable, NSString *_Nullable))completion {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *top = scannerTopViewController();
    if (!top) {
      completion(nil, @"No hay ventana activa");
      return;
    }
    UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:@[ UTTypeFolder ]];
    picker.allowsMultipleSelection = NO;
    JLFolderPickerDelegate *handler = [JLFolderPickerDelegate new];
    handler.done = ^(NSURL *url) {
      if (!url) {
        completion(nil, nil);
        return;
      }
      const BOOL scoped = [url startAccessingSecurityScopedResource];
      NSError *error = nil;
      NSData *bookmark = [url bookmarkDataWithOptions:0 includingResourceValuesForKeys:nil relativeToURL:nil error:&error];
      if (scoped) [url stopAccessingSecurityScopedResource];
      if (!bookmark) {
        completion(nil, error.localizedDescription ?: @"iOS no permitió guardar el acceso a esa carpeta");
        return;
      }
      [NSUserDefaults.standardUserDefaults setObject:bookmark forKey:bookmarkKey];
      [NSUserDefaults.standardUserDefaults setObject:url.lastPathComponent forKey:nameKey];
      completion(url.lastPathComponent, nil);
    };
    g_folderPicker = handler;
    picker.delegate = handler;
    [top presentViewController:picker animated:YES completion:nil];
  });
}

+ (NSString *)linkedInfo {
  NSURL *url = resolveLinkedFolder();
  NSString *name = [NSUserDefaults.standardUserDefaults stringForKey:kFolderNameKey] ?: url.lastPathComponent ?: @"";
  BOOL available = NO;
  if (url) {
    const BOOL scoped = [url startAccessingSecurityScopedResource];
    available = [NSFileManager.defaultManager fileExistsAtPath:url.path];
    if (scoped) [url stopAccessingSecurityScopedResource];
  }
  return toJSON(@{@"linked" : @(url != nil), @"name" : name, @"available" : @(available)});
}

+ (void)unlink {
  [NSUserDefaults.standardUserDefaults removeObjectForKey:kBookmarkKey];
  [NSUserDefaults.standardUserDefaults removeObjectForKey:kFolderNameKey];
}

+ (NSString *)analyze:(NSString *)docs {
  NSURL *root = resolveLinkedFolder();
  if (!root) return toJSON(@{@"ok" : @NO, @"error" : @"No hay ninguna carpeta vinculada"});
  const BOOL scoped = [root startAccessingSecurityScopedResource];
  setStatus(@"analyze", @"", 0, 0);
  NSDictionary *plan = analyzeFolder(root, docs);
  if (scoped) [root stopAccessingSecurityScopedResource];
  clearStatus();
  NSMutableDictionary *out = [plan mutableCopy];
  out[@"ok"] = @YES;
  out[@"folder"] = root.lastPathComponent ?: @"";
  return toJSON(out);
}

+ (NSString *)importInto:(NSString *)docs move:(BOOL)move {
  NSURL *root = resolveLinkedFolder();
  if (!root) return toJSON(@{@"ok" : @NO, @"error" : @"No hay ninguna carpeta vinculada"});
  const BOOL scoped = [root startAccessingSecurityScopedResource];
  setStatus(@"analyze", @"", 0, 0);
  NSDictionary *plan = analyzeFolder(root, docs);
  NSMutableArray<NSDictionary *> *todo = [NSMutableArray array];
  for (NSDictionary *item in plan[@"items"]) {
    if (![item[@"already"] boolValue] && ![item[@"kind"] isEqualToString:@"unknown"] && [item[@"console"] length]) {
      [todo addObject:item];
    }
  }
  NSMutableDictionary *manifest = loadManifest(docs);
  NSMutableDictionary<NSString *, NSNumber *> *imported = [NSMutableDictionary dictionary];
  NSMutableArray<NSString *> *errors = [NSMutableArray array];
  NSUInteger bios = 0, archives = 0, failed = 0, done = 0;
  NSString *rootPath = root.path;
  for (NSDictionary *item in todo) {
    setStatus(@"import", item[@"name"], done++, todo.count);
    NSString *console = item[@"console"];
    NSString *destDir = [docs stringByAppendingPathComponent:console];
    BOOL ok = YES;
    NSString *err = nil;
    NSArray<NSString *> *rels = item[@"files"];
    for (NSString *rel in rels) {
      NSString *destName = [rel isEqualToString:item[@"rel"]] ? item[@"destName"] : rel.lastPathComponent;
      NSURL *src = [NSURL fileURLWithPath:[rootPath stringByAppendingPathComponent:rel]];
      if (!copyCoordinated(src, [destDir stringByAppendingPathComponent:destName], &err)) {
        ok = NO;
        break;
      }
    }
    if (!ok) {
      ++failed;
      [errors addObject:[NSString stringWithFormat:@"%@: %@", item[@"name"], err ?: @"error al copiar"]];
      continue;
    }
    if (move) {
      for (NSString *rel in rels) {
        [NSFileManager.defaultManager removeItemAtPath:[rootPath stringByAppendingPathComponent:rel] error:nil];
      }
    }
    manifest[manifestKey(item)] = @([NSDate date].timeIntervalSince1970);
    NSString *kind = item[@"kind"];
    if ([kind isEqualToString:@"bios"]) {
      ++bios;
    } else {
      if ([kind isEqualToString:@"archive"]) ++archives;
      imported[console] = @(imported[console].unsignedIntegerValue + 1);
    }
  }
  saveManifest(docs, manifest);
  if (scoped) [root stopAccessingSecurityScopedResource];
  clearStatus();
  return toJSON(@{
    @"ok" : @YES, @"imported" : imported, @"bios" : @(bios), @"archives" : @(archives), @"failed" : @(failed),
    @"skipped" : plan[@"summary"][@"already"] ?: @0, @"unknown" : plan[@"summary"][@"unknown"] ?: @0,
    @"icloud" : plan[@"summary"][@"icloud"] ?: @0, @"errors" : errors,
  });
}

+ (NSString *)status {
  @synchronized(JLFolderScanner.class) {
    return toJSON(g_status);
  }
}

+ (NSString *)biosTargetFor:(NSString *)path docs:(NSString *)docs {
  NSString *name = path.lastPathComponent;
  NSString *rel = biosByName(name);
  if (!rel && ![name.pathExtension.lowercaseString isEqualToString:@"zip"]) {
    NSNumber *size = [NSFileManager.defaultManager attributesOfItemAtPath:path error:nil][NSFileSize];
    rel = biosByHash(path, size.unsignedLongLongValue);
  }
  return rel ? [docs stringByAppendingPathComponent:rel] : nil;
}

+ (NSString *)romInfo:(NSString *)path {
  NSString *ext = path.pathExtension.lowercaseString;
  NSString *target = path;
  if ([ext isEqualToString:@"cue"]) {
    NSString *first = sheetTrackNames(path).firstObject;
    if (first) target = [path.stringByDeletingLastPathComponent stringByAppendingPathComponent:first];
  }
  if ([ext isEqualToString:@"gdi"] || [ext isEqualToString:@"cdi"]) return toJSON(@{@"console" : @"dreamcast", @"serial" : @"", @"title" : @""});
  if ([ext isEqualToString:@"zip"] || [ext isEqualToString:@"7z"]) return toJSON(@{@"console" : @"", @"serial" : @"", @"title" : @""});
  const romid::Info info = identifyPath(target);
  return toJSON(@{
    @"console" : [NSString stringWithUTF8String:info.console.c_str()] ?: @"",
    @"serial" : [NSString stringWithUTF8String:info.serial.c_str()] ?: @"",
    @"title" : [NSString stringWithUTF8String:info.title.c_str()] ?: @"",
  });
}

@end
