#import "JLTools.h"

#import <CommonCrypto/CommonDigest.h>
#import <CoreImage/CoreImage.h>
#import <UIKit/UIKit.h>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#include <zlib.h>

#include <atomic>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "Unpack.hpp"

// ---- Página de subida (servida en "/") ---------------------------------------------------------
static const char *kUploadPage = R"HTML(<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JL Emulator · Subir juegos</title>
<style>
:root{--bg:#0b0c10;--card:#15171d;--line:#2a2d36;--gold:#d4af37;--text:#e8e8ea;--dim:#8b8f99}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px -apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:28px 18px}
h1{margin:0 0 4px;font-size:24px;letter-spacing:2px}h1 b{color:var(--gold)}p{color:var(--dim);margin:0 0 20px}
#drop{border:2px dashed var(--line);border-radius:18px;padding:48px 18px;text-align:center;background:var(--card);cursor:pointer;transition:.2s}
#drop.on{border-color:var(--gold);background:#1d1a10}#drop strong{display:block;font-size:18px;margin-bottom:6px}
.f{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-top:10px}
.n{display:flex;justify-content:space-between;gap:10px;font-weight:600}.n span:last-child{color:var(--dim);font-weight:500;white-space:nowrap}
.bar{height:6px;background:#23262e;border-radius:4px;margin-top:8px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:var(--gold);transition:width .15s}
.ok .bar i{background:#22c55e}.err .bar i{background:#ef4444}small{color:var(--dim)}
</style></head><body><main>
<h1>JL <b>EMULATOR</b></h1>
<p>Arrastra aquí tus juegos (.zip, .7z, .iso, .chd, .cue/.bin, .gdi, .wad, BIOS…). Se guardan en el iPhone,
se ordenan por consola y aparecen en la biblioteca con su carátula. Mantén la app abierta mientras se suben.</p>
<label id="drop"><strong>Suelta los archivos o toca para elegirlos</strong><small>Sin límite de tamaño · varios a la vez</small>
<input id="pick" type="file" multiple hidden></label>
<div id="list"></div>
<script>
const list=document.getElementById('list'),drop=document.getElementById('drop'),pick=document.getElementById('pick');
const queue=[];let busy=false;
const fmt=b=>b>1073741824?(b/1073741824).toFixed(2)+' GB':b>1048576?(b/1048576).toFixed(1)+' MB':(b/1024).toFixed(0)+' KB';
function add(files){for(const f of files){const el=document.createElement('div');el.className='f';
el.innerHTML='<div class="n"><span></span><span>En cola</span></div><div class="bar"><i></i></div>';
el.querySelector('.n span').textContent=f.name;list.prepend(el);queue.push({f,el});}next();}
function next(){if(busy||!queue.length)return;busy=true;const {f,el}=queue.shift();const st=el.querySelector('.n span:last-child'),bar=el.querySelector('i');
const x=new XMLHttpRequest();x.open('POST','/upload?name='+encodeURIComponent(f.name));
x.upload.onprogress=e=>{if(e.lengthComputable){bar.style.width=(e.loaded/e.total*100)+'%';st.textContent=fmt(e.loaded)+' / '+fmt(e.total);}};
x.onload=()=>{const ok=x.status===200;el.classList.add(ok?'ok':'err');bar.style.width='100%';st.textContent=ok?'✓ En la biblioteca':'Error: '+x.responseText;busy=false;next();};
x.onerror=()=>{el.classList.add('err');st.textContent='Se cortó la conexión';busy=false;next();};x.send(f);}
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('on')});
drop.addEventListener('dragleave',()=>drop.classList.remove('on'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('on');add(e.dataTransfer.files)});
pick.addEventListener('change',()=>{add(pick.files);pick.value=''});
</script></main></body></html>)HTML";

// ---- Servidor HTTP mínimo ----------------------------------------------------------------------
static std::atomic<int> g_listenFd{-1};
static std::atomic<int> g_port{0};
static std::atomic<int> g_files{0};
static std::atomic<long long> g_bytes{0};
static std::atomic<long long> g_curDone{0};
static std::atomic<long long> g_curTotal{0};
static std::mutex g_statusMutex;
static std::string g_current, g_last, g_error;
static void (^g_onFile)(NSString *) = nil;

static std::string urlDecode(const std::string &s) {
  std::string out;
  for (size_t i = 0; i < s.size(); ++i) {
    if (s[i] == '%' && i + 2 < s.size()) {
      out += char(std::strtol(s.substr(i + 1, 2).c_str(), nullptr, 16));
      i += 2;
    } else {
      out += s[i] == '+' ? ' ' : s[i];
    }
  }
  return out;
}

static bool sendAllBytes(int fd, const char *data, size_t n) {
  while (n > 0) {
    const ssize_t w = send(fd, data, n, 0);
    if (w <= 0) return false;
    data += w;
    n -= size_t(w);
  }
  return true;
}

static void respond(int fd, int code, const char *type, const std::string &body) {
  std::string head = "HTTP/1.1 " + std::to_string(code) + (code == 200 ? " OK" : " Error") +
                     "\r\nContent-Type: " + type + "\r\nContent-Length: " + std::to_string(body.size()) +
                     "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n";
  sendAllBytes(fd, head.data(), head.size());
  sendAllBytes(fd, body.data(), body.size());
}

static void handleClient(int fd) {
  // Cabecera de la petición (hasta 16 KB)
  std::string req;
  char buf[65536];
  size_t headEnd = std::string::npos;
  while (headEnd == std::string::npos && req.size() < 16384) {
    const ssize_t r = recv(fd, buf, sizeof buf, 0);
    if (r <= 0) {
      close(fd);
      return;
    }
    req.append(buf, size_t(r));
    headEnd = req.find("\r\n\r\n");
  }
  if (headEnd == std::string::npos) {
    close(fd);
    return;
  }
  const std::string head = req.substr(0, headEnd);
  std::string body = req.substr(headEnd + 4);
  const auto sp1 = head.find(' '), sp2 = head.find(' ', sp1 + 1);
  const std::string method = head.substr(0, sp1);
  const std::string target = sp1 == std::string::npos ? "/" : head.substr(sp1 + 1, sp2 - sp1 - 1);
  long long length = 0;
  {
    std::string lower = head;
    for (auto &c : lower) c = char(std::tolower((unsigned char)c));
    const auto cl = lower.find("content-length:");
    if (cl != std::string::npos) length = std::atoll(lower.c_str() + cl + 15);
  }

  if (method == "GET") {
    respond(fd, 200, "text/html; charset=utf-8", kUploadPage);
    close(fd);
    return;
  }
  if (method != "POST" || target.rfind("/upload?name=", 0) != 0) {
    respond(fd, 404, "text/plain", "No encontrado");
    close(fd);
    return;
  }
  // Nombre saneado: solo el nombre del archivo, sin carpetas ni archivos ocultos
  NSString *name = [NSString stringWithUTF8String:urlDecode(target.substr(13)).c_str()].lastPathComponent;
  if (!name.length || [name hasPrefix:@"."] || [name containsString:@"/"]) {
    respond(fd, 400, "text/plain", "Nombre no válido");
    close(fd);
    return;
  }
  NSString *docs = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
  NSString *part = [docs stringByAppendingPathComponent:[NSString stringWithFormat:@".%@.upload", name]];
  NSString *dest = [docs stringByAppendingPathComponent:name];
  FILE *out = std::fopen(part.UTF8String, "wb");
  if (!out) {
    respond(fd, 500, "text/plain", "No se pudo crear el archivo");
    close(fd);
    return;
  }
  {
    std::lock_guard<std::mutex> lock(g_statusMutex);
    g_current = name.UTF8String;
  }
  g_curTotal = length;
  g_curDone = 0;
  long long done = 0;
  bool ok = true;
  if (!body.empty()) {
    const size_t n = size_t(std::min<long long>(length, (long long)body.size()));
    ok = std::fwrite(body.data(), 1, n, out) == n;
    done += (long long)n;
  }
  while (ok && done < length) {
    const ssize_t r = recv(fd, buf, size_t(std::min<long long>(sizeof buf, length - done)), 0);
    if (r <= 0) {
      ok = false;
      break;
    }
    ok = std::fwrite(buf, 1, size_t(r), out) == size_t(r);
    done += r;
    g_curDone = done;
  }
  ok = std::fclose(out) == 0 && ok && done == length;
  if (!ok) {
    [NSFileManager.defaultManager removeItemAtPath:part error:nil];
    {
      std::lock_guard<std::mutex> lock(g_statusMutex);
      g_error = std::string("Subida incompleta: ") + name.UTF8String;
      g_current.clear();
    }
    respond(fd, 500, "text/plain", "Subida incompleta (¿iPhone sin espacio o conexión cortada?)");
    close(fd);
    return;
  }
  [NSFileManager.defaultManager removeItemAtPath:dest error:nil];
  [NSFileManager.defaultManager moveItemAtPath:part toPath:dest error:nil];
  g_files += 1;
  g_bytes += done;
  {
    std::lock_guard<std::mutex> lock(g_statusMutex);
    g_last = name.UTF8String;
    g_current.clear();
  }
  respond(fd, 200, "text/plain", "ok");
  close(fd);
  void (^cb)(NSString *) = g_onFile;
  if (cb) cb(dest);
}

// ---- BIOS conocidas (MD5 de las versiones buenas documentadas por libretro) ----------------------
struct BiosSpec {
  const char *console;
  const char *file;  // relativo a system/
  const char *md5;   // vacío = cualquier versión
  bool required;
  const char *note;
};
static const BiosSpec kBios[] = {
    {"PlayStation", "scph5501.bin", "490f666e1afb15b7362b406ed1cea246", false, "SwanStation (calidad HD) la necesita; PCSX usa BIOS HLE"},
    {"PlayStation", "scph5500.bin", "8dd7d5296a650fac7319bce665a6a53c", false, ""},
    {"PlayStation", "scph5502.bin", "32736f17079d0b2b7024407c39bd3050", false, ""},
    {"PlayStation", "scph1001.bin", "924e392ed05558ffdb115408c263dccf", false, ""},
    {"PlayStation", "scph7001.bin", "1e68c231d0896b7eadcad1d7d8e76129", false, ""},
    {"Sega CD / Mega-CD", "bios_CD_U.bin", "2efd74e3232ff260e371b99f84024f7f", true, "Obligatoria para juegos de Sega CD (una de las tres regiones)"},
    {"Sega CD / Mega-CD", "bios_CD_E.bin", "e66fa1dc5820d254611fdcdba0662372", true, ""},
    {"Sega CD / Mega-CD", "bios_CD_J.bin", "278a9397d192149e84e820ac621a8edd", true, ""},
    {"Dreamcast", "dc/dc_boot.bin", "e10c53c2f8b90bab96ead2d368858623", false, "Opcional: sin ella Flycast usa su BIOS HLE"},
    {"Dreamcast", "dc/dc_flash.bin", "0a93f7940c455905bea6e392dfde92a4", false, ""},
    {"Neo-Geo", "neogeo.zip", "", true, "Obligatoria para KOF, Metal Slug… (en arcade/, fbneo/ o system/)"},
    {"Nintendo DS", "bios7.bin", "df692a80a5b1bc90728bc3dfc76cd948", false, "Opcional: melonDS usa FreeBIOS"},
    {"Nintendo DS", "bios9.bin", "a392174eb3e572fed6447e956bde4b25", false, ""},
    {"Sega Saturn", "saturn_bios.bin", "af5828fdff51384f99b3c4926be27762", false, "Opcional: Yabause tiene BIOS HLE"},
};

static NSString *md5Of(NSString *path) {
  FILE *f = std::fopen(path.UTF8String, "rb");
  if (!f) return nil;
  CC_MD5_CTX ctx;
  CC_MD5_Init(&ctx);
  std::vector<uint8_t> buf(1 << 20);
  size_t n;
  while ((n = std::fread(buf.data(), 1, buf.size(), f)) > 0) CC_MD5_Update(&ctx, buf.data(), CC_LONG(n));
  std::fclose(f);
  unsigned char d[CC_MD5_DIGEST_LENGTH];
  CC_MD5_Final(d, &ctx);
  NSMutableString *hex = [NSMutableString string];
  for (int i = 0; i < CC_MD5_DIGEST_LENGTH; ++i) [hex appendFormat:@"%02x", d[i]];
  return hex;
}

// ---- Zip sin compresión (respaldo) ---------------------------------------------------------------
static void put16(std::vector<uint8_t> &v, uint16_t x) {
  v.push_back(uint8_t(x));
  v.push_back(uint8_t(x >> 8));
}
static void put32(std::vector<uint8_t> &v, uint32_t x) {
  for (int i = 0; i < 4; ++i) v.push_back(uint8_t(x >> (8 * i)));
}

@implementation JLTools

+ (BOOL)startUploadServerOnPort:(int)port onFile:(void (^)(NSString *path))onFile {
  g_onFile = [onFile copy];
  if (g_listenFd.load() >= 0) return YES;
  const int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return NO;
  int yes = 1;
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(uint16_t(port));
  addr.sin_addr.s_addr = htonl(INADDR_ANY);
  if (bind(fd, reinterpret_cast<sockaddr *>(&addr), sizeof addr) != 0 || listen(fd, 8) != 0) {
    close(fd);
    std::lock_guard<std::mutex> lock(g_statusMutex);
    g_error = "No se pudo abrir el puerto " + std::to_string(port);
    return NO;
  }
  g_listenFd = fd;
  g_port = port;
  {
    std::lock_guard<std::mutex> lock(g_statusMutex);
    g_error.clear();
  }
  std::thread([fd] {
    while (g_listenFd.load() == fd) {
      const int client = accept(fd, nullptr, nullptr);
      if (client < 0) break;
      int nosig = 1;
      setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &nosig, sizeof nosig);
      std::thread([client] { handleClient(client); }).detach();
    }
  }).detach();
  dispatch_async(dispatch_get_main_queue(), ^{
    UIApplication.sharedApplication.idleTimerDisabled = YES;  // que no se bloquee a mitad de una ISO
  });
  return YES;
}

+ (void)stopUploadServer {
  const int fd = g_listenFd.exchange(-1);
  if (fd >= 0) {
    shutdown(fd, SHUT_RDWR);
    close(fd);
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    UIApplication.sharedApplication.idleTimerDisabled = NO;
  });
}

+ (NSString *)uploadStatus {
  std::lock_guard<std::mutex> lock(g_statusMutex);
  const long long total = g_curTotal.load();
  NSDictionary *d = @{
    @"running" : @(g_listenFd.load() >= 0),
    @"port" : @(g_port.load()),
    @"files" : @(g_files.load()),
    @"bytes" : @(g_bytes.load()),
    @"current" : [NSString stringWithUTF8String:g_current.c_str()] ?: @"",
    @"progress" : @(total > 0 ? double(g_curDone.load()) / double(total) : 0.0),
    @"last" : [NSString stringWithUTF8String:g_last.c_str()] ?: @"",
    @"error" : [NSString stringWithUTF8String:g_error.c_str()] ?: @"",
  };
  NSData *json = [NSJSONSerialization dataWithJSONObject:d options:0 error:nil];
  return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"{}";
}

+ (BOOL)writeQRCode:(NSString *)text toPath:(NSString *)path {
  CIFilter *filter = [CIFilter filterWithName:@"CIQRCodeGenerator"];
  [filter setValue:[text dataUsingEncoding:NSUTF8StringEncoding] forKey:@"inputMessage"];
  [filter setValue:@"M" forKey:@"inputCorrectionLevel"];
  CIImage *qr = filter.outputImage;
  if (!qr) return NO;
  // Escalado entero (módulos nítidos) a ~600 px
  const CGFloat scale = floor(600.0 / qr.extent.size.width);
  CIImage *big = [qr imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
  CIContext *ctx = [CIContext contextWithOptions:nil];
  CGImageRef cg = [ctx createCGImage:big fromRect:big.extent];
  if (!cg) return NO;
  NSData *png = UIImagePNGRepresentation([UIImage imageWithCGImage:cg]);
  CGImageRelease(cg);
  [NSFileManager.defaultManager createDirectoryAtPath:path.stringByDeletingLastPathComponent
                          withIntermediateDirectories:YES
                                           attributes:nil
                                                error:nil];
  return [png writeToFile:path atomically:YES];
}

+ (NSString *)exportBackup:(NSString *)docs error:(NSString **)error {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSMutableArray<NSString *> *files = [NSMutableArray array];
  for (NSString *dir in @[ @"saves", @"states" ]) {
    for (NSString *rel in [fm subpathsOfDirectoryAtPath:[docs stringByAppendingPathComponent:dir] error:nil]) {
      BOOL isDir = NO;
      NSString *full = [[docs stringByAppendingPathComponent:dir] stringByAppendingPathComponent:rel];
      if ([fm fileExistsAtPath:full isDirectory:&isDir] && !isDir && ![rel.lastPathComponent hasPrefix:@"."]) {
        [files addObject:[dir stringByAppendingPathComponent:rel]];
      }
    }
  }
  if (!files.count) {
    if (error) *error = @"Todavía no hay partidas guardadas que respaldar";
    return nil;
  }
  NSDateFormatter *df = [NSDateFormatter new];
  df.dateFormat = @"yyyyMMdd-HHmm";
  NSString *backups = [docs stringByAppendingPathComponent:@"Backups"];
  [fm createDirectoryAtPath:backups withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *dest = [backups stringByAppendingPathComponent:
                                [NSString stringWithFormat:@"JL-respaldo-%@.zip", [df stringFromDate:NSDate.date]]];
  FILE *out = std::fopen(dest.UTF8String, "wb");
  if (!out) {
    if (error) *error = @"No se pudo crear el archivo de respaldo";
    return nil;
  }
  std::vector<uint8_t> central;
  uint32_t offset = 0;
  uint16_t count = 0;
  std::vector<uint8_t> buf(1 << 20);
  for (NSString *rel in files) {
    NSString *full = [docs stringByAppendingPathComponent:rel];
    FILE *in = std::fopen(full.UTF8String, "rb");
    if (!in) continue;
    // CRC y tamaño en una primera pasada (zip "stored": sin compresión, máxima compatibilidad)
    uLong crc = crc32(0L, Z_NULL, 0);
    uint64_t size = 0;
    size_t n;
    while ((n = std::fread(buf.data(), 1, buf.size(), in)) > 0) {
      crc = crc32(crc, buf.data(), uInt(n));
      size += n;
    }
    if (size >= 0xFFFFFFFFull || uint64_t(offset) + size > 0xF0000000ull) {
      std::fclose(in);
      continue;  // sin Zip64: un respaldo de partidas nunca se acerca a 4 GB
    }
    const std::string name = rel.UTF8String;
    std::vector<uint8_t> lh;
    put32(lh, 0x04034b50);
    put16(lh, 20);
    put16(lh, 0x0800);  // nombres UTF-8
    put16(lh, 0);
    put16(lh, 0);
    put16(lh, 0x21);
    put32(lh, uint32_t(crc));
    put32(lh, uint32_t(size));
    put32(lh, uint32_t(size));
    put16(lh, uint16_t(name.size()));
    put16(lh, 0);
    std::fwrite(lh.data(), 1, lh.size(), out);
    std::fwrite(name.data(), 1, name.size(), out);
    std::rewind(in);
    while ((n = std::fread(buf.data(), 1, buf.size(), in)) > 0) std::fwrite(buf.data(), 1, n, out);
    std::fclose(in);
    put32(central, 0x02014b50);
    put16(central, 20);
    put16(central, 20);
    put16(central, 0x0800);
    put16(central, 0);
    put16(central, 0);
    put16(central, 0x21);
    put32(central, uint32_t(crc));
    put32(central, uint32_t(size));
    put32(central, uint32_t(size));
    put16(central, uint16_t(name.size()));
    put16(central, 0);
    put16(central, 0);
    put16(central, 0);
    put16(central, 0);
    put32(central, 0);
    put32(central, offset);
    central.insert(central.end(), name.begin(), name.end());
    offset += uint32_t(lh.size() + name.size() + size);
    ++count;
  }
  std::vector<uint8_t> eocd;
  put32(eocd, 0x06054b50);
  put16(eocd, 0);
  put16(eocd, 0);
  put16(eocd, count);
  put16(eocd, count);
  put32(eocd, uint32_t(central.size()));
  put32(eocd, offset);
  put16(eocd, 0);
  std::fwrite(central.data(), 1, central.size(), out);
  std::fwrite(eocd.data(), 1, eocd.size(), out);
  if (std::fclose(out) != 0) {
    if (error) *error = @"No se pudo terminar el respaldo (¿iPhone sin espacio?)";
    return nil;
  }
  return dest;
}

+ (NSInteger)restoreBackup:(NSString *)zipPath docs:(NSString *)docs error:(NSString **)error {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *tmp = [NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
  [fm createDirectoryAtPath:tmp withIntermediateDirectories:YES attributes:nil error:nil];
  unpack::Result r = unpack::extractTree(zipPath.UTF8String, tmp.UTF8String);
  if (!r.error.empty() && r.files.empty()) {
    if (error) *error = [NSString stringWithUTF8String:r.error.c_str()];
    [fm removeItemAtPath:tmp error:nil];
    return -1;
  }
  NSInteger restored = 0;
  for (NSString *dir in @[ @"saves", @"states" ]) {
    NSString *src = [tmp stringByAppendingPathComponent:dir];
    for (NSString *rel in [fm subpathsOfDirectoryAtPath:src error:nil]) {
      BOOL isDir = NO;
      NSString *from = [src stringByAppendingPathComponent:rel];
      if (![fm fileExistsAtPath:from isDirectory:&isDir] || isDir) continue;
      NSString *to = [[docs stringByAppendingPathComponent:dir] stringByAppendingPathComponent:rel];
      [fm createDirectoryAtPath:to.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
      [fm removeItemAtPath:to error:nil];
      if ([fm moveItemAtPath:from toPath:to error:nil]) ++restored;
    }
  }
  [fm removeItemAtPath:tmp error:nil];
  if (!restored && error) *error = @"El .zip no contiene carpetas saves/ ni states/ de JL Emulator";
  return restored;
}

+ (NSString *)biosStatus:(NSString *)docs {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSMutableArray *out = [NSMutableArray array];
  for (const BiosSpec &b : kBios) {
    NSString *file = [NSString stringWithUTF8String:b.file];
    NSArray<NSString *> *places = [file isEqualToString:@"neogeo.zip"]
                                      ? @[ @"system", @"arcade", @"fbneo" ]
                                      : @[ @"system" ];
    NSString *found = nil;
    for (NSString *dir in places) {
      NSString *p = [[docs stringByAppendingPathComponent:dir] stringByAppendingPathComponent:file];
      if ([fm fileExistsAtPath:p]) {
        found = p;
        break;
      }
    }
    id md5ok = NSNull.null;
    if (found && std::strlen(b.md5)) {
      NSString *sum = md5Of(found);
      md5ok = @(sum && [sum isEqualToString:[NSString stringWithUTF8String:b.md5]]);
    }
    [out addObject:@{
      @"console" : [NSString stringWithUTF8String:b.console],
      @"file" : file,
      @"found" : @(found != nil),
      @"md5ok" : md5ok,
      @"required" : @(b.required),
      @"note" : [NSString stringWithUTF8String:b.note],
    }];
  }
  NSData *json = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
  return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]";
}

@end
