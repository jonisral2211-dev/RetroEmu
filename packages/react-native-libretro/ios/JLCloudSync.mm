#import "JLCloudSync.h"

#import "FolderScanner.h"

static NSString *const kCloudBookmarkKey = @"jl.cloudSync.bookmark.v1";
static NSString *const kCloudNameKey = @"jl.cloudSync.name.v1";
static NSString *const kCloudLastKey = @"jl.cloudSync.last.v1";
// Subcarpeta dentro de la elegida: así no se mezcla con otros archivos del usuario
static NSString *const kCloudSubdir = @"JL Emulator Partidas";

static NSString *toJSON(id obj) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:obj options:0 error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
}

// ¿El archivo pertenece a las partidas de este juego? (<base>.srm, <base>.state12, <base>_1.mcr…)
static BOOL belongsTo(NSString *name, NSString *base) {
  if (base.length == 0) return ![name hasPrefix:@"."];
  return [name hasPrefix:[base stringByAppendingString:@"."]] || [name hasPrefix:[base stringByAppendingString:@"_"]];
}

static NSDate *mtime(NSString *path) {
  return [NSFileManager.defaultManager attributesOfItemAtPath:path error:nil].fileModificationDate;
}

// Copia coordinada (iCloud Drive) conservando la fecha de origen: evita copiar de vuelta
static BOOL coordinatedCopy(NSURL *from, NSURL *to, NSDate *date) {
  __block BOOL ok = NO;
  NSError *coordError = nil;
  NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
  [coordinator coordinateReadingItemAtURL:from
                                  options:NSFileCoordinatorReadingWithoutChanges
                         writingItemAtURL:to
                                  options:NSFileCoordinatorWritingForReplacing
                                    error:&coordError
                               byAccessor:^(NSURL *src, NSURL *dst) {
                                 NSFileManager *fm = NSFileManager.defaultManager;
                                 NSURL *tmp = [dst.URLByDeletingLastPathComponent
                                     URLByAppendingPathComponent:[NSString stringWithFormat:@".%@.part", dst.lastPathComponent]];
                                 [fm removeItemAtURL:tmp error:nil];
                                 if (![fm copyItemAtURL:src toURL:tmp error:nil]) return;
                                 if (date) [fm setAttributes:@{NSFileModificationDate : date} ofItemAtPath:tmp.path error:nil];
                                 [fm removeItemAtURL:dst error:nil];
                                 ok = [fm moveItemAtURL:tmp toURL:dst error:nil];
                                 if (!ok) [fm removeItemAtURL:tmp error:nil];
                               }];
  return ok;
}

// Sincroniza un par de carpetas (local <-> nube) para los archivos del juego
static void syncDir(NSString *local, NSURL *remote, NSString *base, BOOL push, BOOL pull, NSUInteger *pushed,
                    NSUInteger *pulled, NSUInteger *pending) {
  NSFileManager *fm = NSFileManager.defaultManager;
  [fm createDirectoryAtPath:local withIntermediateDirectories:YES attributes:nil error:nil];
  [fm createDirectoryAtURL:remote withIntermediateDirectories:YES attributes:nil error:nil];

  NSMutableDictionary<NSString *, NSDate *> *remoteFiles = [NSMutableDictionary dictionary];
  NSArray<NSURL *> *items = [fm contentsOfDirectoryAtURL:remote
                              includingPropertiesForKeys:@[ NSURLContentModificationDateKey ]
                                                 options:0
                                                   error:nil];
  for (NSURL *item in items) {
    NSString *name = item.lastPathComponent;
    // Marcador de iCloud sin descargar: ".nombre.icloud" -> pedir la descarga y seguir
    if ([name hasPrefix:@"."] && [name hasSuffix:@".icloud"]) {
      NSString *real = [[name substringFromIndex:1] stringByDeletingPathExtension];
      if (!belongsTo(real, base)) continue;
      if (pull) {
        [fm startDownloadingUbiquitousItemAtURL:[remote URLByAppendingPathComponent:real] error:nil];
        ++*pending;
      }
      continue;
    }
    if ([name hasPrefix:@"."] || !belongsTo(name, base)) continue;
    NSNumber *isDir = nil;
    [item getResourceValue:&isDir forKey:NSURLIsDirectoryKey error:nil];
    if (isDir.boolValue) continue;
    NSDate *date = nil;
    [item getResourceValue:&date forKey:NSURLContentModificationDateKey error:nil];
    remoteFiles[name] = date ?: NSDate.distantPast;
  }

  NSMutableSet<NSString *> *seen = [NSMutableSet set];
  for (NSString *name in [fm contentsOfDirectoryAtPath:local error:nil]) {
    if ([name hasPrefix:@"."] || [name hasSuffix:@".part"] || !belongsTo(name, base)) continue;
    NSString *path = [local stringByAppendingPathComponent:name];
    BOOL dir = NO;
    if (![fm fileExistsAtPath:path isDirectory:&dir] || dir) continue;
    [seen addObject:name];
    NSDate *localDate = mtime(path) ?: NSDate.distantPast;
    NSDate *remoteDate = remoteFiles[name];
    const NSTimeInterval diff = remoteDate ? [localDate timeIntervalSinceDate:remoteDate] : 1e9;
    NSURL *remoteURL = [remote URLByAppendingPathComponent:name];
    if (push && diff > 1.0) {
      if (coordinatedCopy([NSURL fileURLWithPath:path], remoteURL, localDate)) ++*pushed;
    } else if (pull && diff < -1.0) {
      if (coordinatedCopy(remoteURL, [NSURL fileURLWithPath:path], remoteDate)) ++*pulled;
    }
  }
  // Solo en la nube (otro dispositivo o restauración): se trae
  if (pull) {
    for (NSString *name in remoteFiles) {
      if ([seen containsObject:name]) continue;
      NSURL *remoteURL = [remote URLByAppendingPathComponent:name];
      if (coordinatedCopy(remoteURL, [NSURL fileURLWithPath:[local stringByAppendingPathComponent:name]], remoteFiles[name])) {
        ++*pulled;
      }
    }
  }
}

@implementation JLCloudSync

+ (void)pickFolderWithCompletion:(void (^)(NSString *_Nullable, NSString *_Nullable))completion {
  [JLFolderScanner pickFolderStoringBookmark:kCloudBookmarkKey name:kCloudNameKey completion:completion];
}

+ (NSString *)info {
  NSURL *url = [JLFolderScanner resolveBookmark:kCloudBookmarkKey];
  NSString *name = [NSUserDefaults.standardUserDefaults stringForKey:kCloudNameKey] ?: url.lastPathComponent ?: @"";
  BOOL available = NO;
  if (url) {
    const BOOL scoped = [url startAccessingSecurityScopedResource];
    available = [NSFileManager.defaultManager fileExistsAtPath:url.path];
    if (scoped) [url stopAccessingSecurityScopedResource];
  }
  const double last = [NSUserDefaults.standardUserDefaults doubleForKey:kCloudLastKey];
  return toJSON(@{@"linked" : @(url != nil), @"name" : name, @"available" : @(available), @"lastSync" : @(last)});
}

+ (void)unlink {
  [NSUserDefaults.standardUserDefaults removeObjectForKey:kCloudBookmarkKey];
  [NSUserDefaults.standardUserDefaults removeObjectForKey:kCloudNameKey];
}

+ (NSString *)syncGame:(NSString *)romPath docs:(NSString *)docs direction:(NSString *)direction {
  NSURL *root = [JLFolderScanner resolveBookmark:kCloudBookmarkKey];
  if (!root) return toJSON(@{@"ok" : @NO, @"error" : @"No hay carpeta de iCloud vinculada"});
  @synchronized(self) {
    const BOOL scoped = [root startAccessingSecurityScopedResource];
    if (![NSFileManager.defaultManager fileExistsAtPath:root.path]) {
      if (scoped) [root stopAccessingSecurityScopedResource];
      return toJSON(@{@"ok" : @NO, @"error" : @"La carpeta de iCloud no está disponible (¿sin conexión?)"});
    }
    NSString *base = romPath.length ? romPath.lastPathComponent.stringByDeletingPathExtension : @"";
    const BOOL push = ![direction isEqualToString:@"pull"];
    const BOOL pull = ![direction isEqualToString:@"push"];
    NSUInteger pushed = 0, pulled = 0, pending = 0;
    NSURL *cloud = [root URLByAppendingPathComponent:kCloudSubdir isDirectory:YES];
    for (NSString *dir in @[ @"saves", @"states" ]) {
      syncDir([docs stringByAppendingPathComponent:dir], [cloud URLByAppendingPathComponent:dir isDirectory:YES], base, push,
              pull, &pushed, &pulled, &pending);
    }
    if (scoped) [root stopAccessingSecurityScopedResource];
    [NSUserDefaults.standardUserDefaults setDouble:NSDate.date.timeIntervalSince1970 * 1000.0 forKey:kCloudLastKey];
    return toJSON(@{@"ok" : @YES, @"pushed" : @(pushed), @"pulled" : @(pulled), @"pending" : @(pending)});
  }
}

@end
