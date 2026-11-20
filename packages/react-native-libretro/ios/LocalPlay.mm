// Multijugador en red local: servidor HTTP + WebSocket + MJPEG embebido en el iPhone anfitrión.
// Ver LocalPlay.hpp para las rutas. Las ranuras P2..P4 se llevan al núcleo con host::setGamepadPort.
#import <CommonCrypto/CommonDigest.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>

#include "LocalPlay.hpp"

#include "FrameBuffer.hpp"
#include "LibretroHost.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

namespace localplay {
namespace {

// Página del mando del jugador (se sirve en "/")
const char *kPage = R"HTML(<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>JL Emulator · Mando</title>
<style>
html,body{margin:0;height:100%;background:#0D0E12;color:#ECEDEF;font-family:-apple-system,system-ui,sans-serif;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none}
#video{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;opacity:.6;display:none;pointer-events:none}
.screen{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px}
.screen button{width:min(80vw,320px);padding:16px;border-radius:12px;border:1px solid #D4AF37;background:#15171D;color:#D4AF37;font-size:17px;font-weight:700}
#pad{position:fixed;inset:0;display:none}
.b{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#1D2028;border:2px solid #D4AF37;color:#ECEDEF;font-weight:800;font-size:19px}
.b.on{background:#D4AF37;color:#0D0E12}
.pill{position:absolute;border-radius:14px;width:86px;height:34px;font-size:13px}
#stick{position:absolute;left:8%;top:44%;width:112px;height:112px;margin-left:-56px;margin-top:-56px;border-radius:50%;background:rgba(255,255,255,.05);border:2px solid #7D828C}
#knob{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:#D4AF37}
#toggle{position:absolute;top:10px;left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:14px;border:1px solid #D4AF37;background:#15171D;color:#D4AF37;font-size:13px;font-weight:700}
#msg{color:#7D828C;font-size:14px;text-align:center;min-height:18px}
</style></head><body>
<img id="video" alt="">
<div id="join" class="screen">
  <h2 style="margin:0;color:#D4AF37">JL Emulator</h2>
  <p style="margin:0;color:#7D828C">Elige tu jugador</p>
  <button data-s="2">Jugador 2 · P2</button>
  <button data-s="3">Jugador 3 · P3</button>
  <button data-s="4">Jugador 4 · P4</button>
  <div id="msg"></div>
</div>
<div id="pad">
  <button id="toggle">Pantalla + Palanca: desactivada</button>
  <div id="stick"><div id="knob"></div></div>
  <div class="b" data-b="UP" style="left:14%;top:52%;width:62px;height:62px;margin-left:-31px">▲</div>
  <div class="b" data-b="DOWN" style="left:14%;top:72%;width:62px;height:62px;margin-left:-31px">▼</div>
  <div class="b" data-b="LEFT" style="left:6%;top:62%;width:62px;height:62px">◀</div>
  <div class="b" data-b="RIGHT" style="left:22%;top:62%;width:62px;height:62px">▶</div>
  <div class="b" data-b="Y" style="right:22%;top:62%;width:62px;height:62px">Y</div>
  <div class="b" data-b="X" style="right:14%;top:52%;width:62px;height:62px;margin-right:-31px">X</div>
  <div class="b" data-b="B" style="right:14%;top:72%;width:62px;height:62px;margin-right:-31px">B</div>
  <div class="b" data-b="A" style="right:6%;top:62%;width:62px;height:62px">A</div>
  <div class="b pill" data-b="SELECT" style="left:calc(50% - 96px);bottom:24px">SELECT</div>
  <div class="b pill" data-b="START" style="left:calc(50% + 10px);bottom:24px">START</div>
  <div class="b pill" data-b="L" style="left:14px;top:14px;width:90px;height:38px">L</div>
  <div class="b pill" data-b="R" style="right:14px;top:14px;width:90px;height:38px">R</div>
</div>
<script>
var BTN={B:1,Y:2,SELECT:4,START:8,UP:16,DOWN:32,LEFT:64,RIGHT:128,A:256,X:512,L:1024,R:2048};
var ws=null,seat=0,bits=0,lx=0,ly=0,dirty=false,streamOn=false,loopOn=false;
function msg(t){document.getElementById('msg').textContent=t;}
function showJoin(){document.getElementById('join').style.display='flex';document.getElementById('pad').style.display='none';document.getElementById('video').style.display='none';}
function showPad(){document.getElementById('join').style.display='none';document.getElementById('pad').style.display='block';if(!loopOn){loopOn=true;requestAnimationFrame(loop);}}
function send(){
  if(!ws||ws.readyState!==1||!seat)return;
  var b=new ArrayBuffer(6),dv=new DataView(b);
  dv.setUint8(0,bits&255);dv.setUint8(1,(bits>>8)&255);
  dv.setInt8(2,Math.round(lx*127));dv.setInt8(3,Math.round(ly*127));
  dv.setInt8(4,0);dv.setInt8(5,0);
  ws.send(b);
}
function loop(){
  if(dirty){dirty=false;send();}
  if(seat){requestAnimationFrame(loop);}else{loopOn=false;}
}
function connect(n){
  var proto=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(proto+'://'+location.host+'/ws');
  ws.binaryType='arraybuffer';
  ws.onopen=function(){ws.send('hello:'+n);};
  ws.onmessage=function(e){
    if(typeof e.data!=='string')return;
    if(e.data.indexOf('seat:')===0){seat=Number(e.data.slice(5));msg('');showPad();}
    else if(e.data==='busy'){msg('Ese jugador ya está ocupado');ws.close();}
  };
  ws.onclose=function(){seat=0;streamOn=false;setStream(false);showJoin();};
}
document.querySelectorAll('#join button').forEach(function(btn){
  btn.addEventListener('click',function(){connect(Number(btn.getAttribute('data-s')));});
});
function press(el,on){
  var k=el.getAttribute('data-b');
  if(!BTN[k])return;
  if(on){bits|=BTN[k];el.classList.add('on');}else{bits&=~BTN[k];el.classList.remove('on');}
  dirty=true;
}
document.querySelectorAll('#pad .b').forEach(function(el){
  el.addEventListener('pointerdown',function(e){e.preventDefault();el.setPointerCapture(e.pointerId);press(el,true);});
  el.addEventListener('pointerup',function(){press(el,false);});
  el.addEventListener('pointercancel',function(){press(el,false);});
});
var stick=document.getElementById('stick'),knob=document.getElementById('knob'),stickId=null;
function stickAt(e){
  var r=stick.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,rad=r.width/2;
  var dx=(e.clientX-cx)/rad,dy=(e.clientY-cy)/rad,m=Math.sqrt(dx*dx+dy*dy);
  if(m>1){dx/=m;dy/=m;}
  lx=dx;ly=dy;
  knob.style.transform='translate('+(dx*rad*0.6)+'px,'+(dy*rad*0.6)+'px)';
  dirty=true;
}
stick.addEventListener('pointerdown',function(e){e.preventDefault();stickId=e.pointerId;stick.setPointerCapture(e.pointerId);stickAt(e);});
stick.addEventListener('pointermove',function(e){if(e.pointerId===stickId)stickAt(e);});
function endStick(e){if(e.pointerId!==stickId)return;stickId=null;lx=0;ly=0;knob.style.transform='';dirty=true;}
stick.addEventListener('pointerup',endStick);
stick.addEventListener('pointercancel',endStick);
function setStream(on){
  var v=document.getElementById('video'),t=document.getElementById('toggle');
  t.textContent='Pantalla + Palanca: '+(on?'activada':'desactivada');
  if(on&&seat){v.src='/stream.mjpeg?p='+seat+'&t='+Date.now();v.style.display='block';}
  else{v.removeAttribute('src');v.style.display='none';}
}
document.getElementById('toggle').addEventListener('click',function(){
  streamOn=!streamOn;
  if(ws&&ws.readyState===1)ws.send(streamOn?'stream:1':'stream:0');
  setStream(streamOn);
});
document.getElementById('video').addEventListener('error',function(){
  if(streamOn&&seat)setTimeout(function(){setStream(true);},1000);
});
</script></body></html>
)HTML";

std::atomic<bool> g_running{false};
int g_listenFd = -1;
std::mutex g_mutex;             // ranuras, clientes y banderas de video
std::set<int> g_clients;        // sockets abiertos (para cerrarlos al parar)
bool g_seat[4] = {false, false, false, false};  // índice = ranura del juego (1..3 = P2..P4)
bool g_stream[4] = {false, false, false, false};

bool sendAll(int fd, const void *data, size_t len) {
  const char *p = static_cast<const char *>(data);
  while (len > 0) {
    const ssize_t w = send(fd, p, len, 0);
    if (w <= 0) return false;
    p += w;
    len -= size_t(w);
  }
  return true;
}

bool readExact(int fd, void *out, size_t len) {
  char *p = static_cast<char *>(out);
  while (len > 0) {
    const ssize_t r = recv(fd, p, len, 0);
    if (r <= 0) return false;
    p += r;
    len -= size_t(r);
  }
  return true;
}

void respond(int fd, int code, const char *type, const std::string &body) {
  const std::string head = "HTTP/1.1 " + std::to_string(code) + (code == 200 ? " OK" : " Error") +
                           "\r\nContent-Type: " + type + "\r\nContent-Length: " + std::to_string(body.size()) +
                           "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n";
  sendAll(fd, head.data(), head.size());
  sendAll(fd, body.data(), body.size());
}

std::string lower(std::string s) {
  for (auto &c : s) c = char(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

// Valor de una cabecera (sin espacios), o "" si no existe
std::string headerValue(const std::string &head, const std::string &name) {
  const std::string lh = lower(head);
  const std::string key = lower(name) + ":";
  const auto at = lh.find("\r\n" + key);
  if (at == std::string::npos) return "";
  const auto start = at + 2 + key.size();
  const auto end = head.find("\r\n", start);
  std::string v = head.substr(start, end == std::string::npos ? std::string::npos : end - start);
  while (!v.empty() && v.front() == ' ') v.erase(v.begin());
  while (!v.empty() && (v.back() == ' ' || v.back() == '\r')) v.pop_back();
  return v;
}

// Valor de un parámetro de la query ("p=2" -> 2), o 0
int queryInt(const std::string &query, const std::string &key) {
  const std::string k = key + "=";
  size_t at = 0;
  while ((at = query.find(k, at)) != std::string::npos) {
    if (at == 0 || query[at - 1] == '&') return std::atoi(query.c_str() + at + k.size());
    at += k.size();
  }
  return 0;
}

std::string wsAccept(const std::string &key) {
  const std::string joined = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  unsigned char digest[CC_SHA1_DIGEST_LENGTH];
  CC_SHA1(joined.data(), CC_LONG(joined.size()), digest);
  NSData *d = [NSData dataWithBytes:digest length:CC_SHA1_DIGEST_LENGTH];
  return std::string([[d base64EncodedStringWithOptions:0] UTF8String]);
}

// Mensaje de texto del servidor (sin máscara)
bool sendText(int fd, const std::string &text) {
  std::string frame;
  frame.push_back(char(0x81));
  if (text.size() < 126) {
    frame.push_back(char(text.size()));
  } else {
    frame.push_back(char(126));
    frame.push_back(char((text.size() >> 8) & 0xFF));
    frame.push_back(char(text.size() & 0xFF));
  }
  frame += text;
  return sendAll(fd, frame.data(), frame.size());
}

// JPEG del último frame del juego, reducido a maxHeight píxeles de alto
NSData *encodeFrame(size_t maxHeight) {
  FrameBuffer &fb = host::frame();
  size_t w = 0, h = 0, stride = 0;
  std::vector<uint8_t> pixels;
  {
    std::lock_guard<std::mutex> lock(fb.mutex);
    if (fb.width == 0 || fb.height == 0 || fb.stride != size_t(fb.width) * 4 ||
        fb.pixels.size() < fb.stride * size_t(fb.height)) {
      return nil;
    }
    w = fb.width;
    h = fb.height;
    stride = fb.stride;
    pixels.assign(fb.pixels.begin(), fb.pixels.begin() + long(stride * h));
  }
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef src = CGBitmapContextCreate(pixels.data(), w, h, 8, stride, space,
                                           kCGBitmapByteOrder32Little | kCGImageAlphaNoneSkipFirst);
  CGImageRef full = src ? CGBitmapContextCreateImage(src) : NULL;
  if (src) CGContextRelease(src);
  if (!full) {
    CGColorSpaceRelease(space);
    return nil;
  }
  const size_t th = std::min<size_t>(h, maxHeight);
  const size_t tw = std::max<size_t>(1, w * th / h);
  CGContextRef dst = CGBitmapContextCreate(NULL, tw, th, 8, 0, space, kCGImageAlphaNoneSkipLast);
  CGImageRef small = NULL;
  if (dst) {
    CGContextSetInterpolationQuality(dst, kCGInterpolationMedium);
    CGContextDrawImage(dst, CGRectMake(0, 0, CGFloat(tw), CGFloat(th)), full);
    small = CGBitmapContextCreateImage(dst);
    CGContextRelease(dst);
  }
  CGImageRelease(full);
  CGColorSpaceRelease(space);
  if (!small) return nil;
  NSMutableData *data = [NSMutableData data];
  CGImageDestinationRef out = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)data, CFSTR("public.jpeg"), 1, NULL);
  BOOL ok = NO;
  if (out) {
    NSDictionary *opts = @{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality : @0.6};
    CGImageDestinationAddImage(out, small, (__bridge CFDictionaryRef)opts);
    ok = CGImageDestinationFinalize(out);
    CFRelease(out);
  }
  CGImageRelease(small);
  return ok ? data : nil;
}

// Video MJPEG para la ranura p (solo mientras el jugador tenga activada "Pantalla + Palanca")
void serveMjpeg(int fd, int p) {
  const int seat = p - 1;
  if (seat < 1 || seat > 3) return;
  // El WebSocket puede llegar un instante después que la petición de imagen: se espera un poco
  for (int i = 0; i < 20; ++i) {
    bool on;
    {
      std::lock_guard<std::mutex> lock(g_mutex);
      on = g_stream[seat] && g_seat[seat];
    }
    if (on) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }
  const std::string head = "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\n"
                           "Cache-Control: no-store\r\nConnection: close\r\n\r\n";
  if (!sendAll(fd, head.data(), head.size())) return;
  while (g_running) {
    bool on;
    {
      std::lock_guard<std::mutex> lock(g_mutex);
      on = g_stream[seat] && g_seat[seat];
    }
    if (!on) break;
    NSData *jpg = encodeFrame(480);
    if (jpg) {
      const std::string part = "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " +
                               std::to_string(jpg.length) + "\r\n\r\n";
      if (!sendAll(fd, part.data(), part.size())) break;
      if (!sendAll(fd, jpg.bytes, jpg.length)) break;
      if (!sendAll(fd, "\r\n", 2)) break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(66));  // ~15 imágenes por segundo
  }
}

void releaseSeat(int seat) {
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_seat[seat] = false;
    g_stream[seat] = false;
  }
  host::setGamepadPort(seat, 0, 0, 0, 0, 0, 0, 0);
}

// Sesión WebSocket: asignación de ranura, video on/off y botones en binario
void serveWebSocket(int fd, const std::string &head) {
  const std::string key = headerValue(head, "Sec-WebSocket-Key");
  if (key.empty()) return;
  const std::string reply = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                            "Sec-WebSocket-Accept: " + wsAccept(key) + "\r\n\r\n";
  if (!sendAll(fd, reply.data(), reply.size())) return;
  int seat = 0;
  for (;;) {
    uint8_t h[2];
    if (!readExact(fd, h, 2)) break;
    const int opcode = h[0] & 0x0F;
    const bool masked = (h[1] & 0x80) != 0;
    uint64_t len = h[1] & 0x7F;
    if (len == 126) {
      uint8_t e[2];
      if (!readExact(fd, e, 2)) break;
      len = (uint64_t(e[0]) << 8) | e[1];
    } else if (len == 127) {
      uint8_t e[8];
      if (!readExact(fd, e, 8)) break;
      len = 0;
      for (int i = 0; i < 8; ++i) len = (len << 8) | e[i];
    }
    if (len > 65536) break;
    uint8_t mask[4] = {0, 0, 0, 0};
    if (masked && !readExact(fd, mask, 4)) break;
    std::string payload(size_t(len), '\0');
    if (len > 0 && !readExact(fd, &payload[0], size_t(len))) break;
    if (masked) {
      for (size_t i = 0; i < payload.size(); ++i) payload[i] = char(payload[i] ^ mask[i % 4]);
    }
    if (opcode == 0x8) break;  // cierre
    if (opcode == 0x9) {       // ping -> pong
      std::string pong;
      pong.push_back(char(0x8A));
      pong.push_back(char(payload.size()));
      pong += payload;
      if (!sendAll(fd, pong.data(), pong.size())) break;
      continue;
    }
    if (opcode == 0x1) {  // texto: "hello:N" o "stream:0|1"
      if (payload.rfind("hello:", 0) == 0 && seat == 0) {
        const int n = std::atoi(payload.c_str() + 6);
        bool claimed = false;
        if (n >= 2 && n <= 4) {
          std::lock_guard<std::mutex> lock(g_mutex);
          if (!g_seat[n - 1]) {
            g_seat[n - 1] = true;
            claimed = true;
          }
        }
        if (claimed) {
          seat = n - 1;
          if (!sendText(fd, "seat:" + std::to_string(n))) break;
        } else if (!sendText(fd, "busy")) {
          break;
        }
      } else if (payload.rfind("stream:", 0) == 0 && seat != 0) {
        std::lock_guard<std::mutex> lock(g_mutex);
        g_stream[seat] = payload.size() > 7 && payload[7] == '1';
      }
      continue;
    }
    if (opcode == 0x2 && seat != 0 && payload.size() >= 6) {  // binario: [botones lo, hi, lx, ly, rx, ry]
      const uint8_t *d = reinterpret_cast<const uint8_t *>(payload.data());
      const uint16_t buttons = uint16_t(d[0] | (d[1] << 8));
      const int8_t lx = int8_t(d[2]), ly = int8_t(d[3]), rx = int8_t(d[4]), ry = int8_t(d[5]);
      host::setGamepadPort(seat, buttons, lx / 127.0, ly / 127.0, rx / 127.0, ry / 127.0, 0, 0);
    }
  }
  if (seat != 0) releaseSeat(seat);
}

void handleClient(int fd) {
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_clients.insert(fd);
  }
  std::string req;
  char buf[4096];
  while (req.find("\r\n\r\n") == std::string::npos && req.size() < 16384) {
    const ssize_t r = recv(fd, buf, sizeof buf, 0);
    if (r <= 0) break;
    req.append(buf, size_t(r));
  }
  const size_t headEnd = req.find("\r\n\r\n");
  if (headEnd != std::string::npos) {
    const std::string head = req.substr(0, headEnd);
    const size_t sp1 = head.find(' ');
    const size_t sp2 = sp1 == std::string::npos ? std::string::npos : head.find(' ', sp1 + 1);
    const std::string method = sp1 == std::string::npos ? "" : head.substr(0, sp1);
    const std::string target = (sp1 == std::string::npos || sp2 == std::string::npos)
                                   ? "/"
                                   : head.substr(sp1 + 1, sp2 - sp1 - 1);
    std::string path = target, query;
    const size_t q = target.find('?');
    if (q != std::string::npos) {
      path = target.substr(0, q);
      query = target.substr(q + 1);
    }
    const bool upgrade = lower(headerValue(head, "Upgrade")) == "websocket";
    if (method == "GET" && path == "/ws" && upgrade) {
      serveWebSocket(fd, head);
    } else if (method == "GET" && path == "/stream.mjpeg") {
      serveMjpeg(fd, queryInt(query, "p"));
    } else if (method == "GET" && (path == "/" || path == "/index.html")) {
      respond(fd, 200, "text/html; charset=utf-8", kPage);
    } else {
      respond(fd, 404, "text/plain", "No encontrado");
    }
  }
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_clients.erase(fd);
  }
  close(fd);
}

void acceptLoop(int listenFd) {
  while (g_running) {
    const int c = accept(listenFd, nullptr, nullptr);
    if (c < 0) {
      if (!g_running) break;
      continue;
    }
    std::thread(handleClient, c).detach();
  }
}

}  // namespace

bool start(uint16_t port) {
  if (g_running) return true;
  const int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return false;
  int one = 1;
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(port);
  addr.sin_addr.s_addr = htonl(INADDR_ANY);
  if (bind(fd, reinterpret_cast<sockaddr *>(&addr), sizeof addr) != 0 || listen(fd, 8) != 0) {
    close(fd);
    return false;
  }
  g_listenFd = fd;
  g_running = true;
  std::thread(acceptLoop, fd).detach();
  return true;
}

void stop() {
  g_running = false;
  if (g_listenFd >= 0) {
    shutdown(g_listenFd, SHUT_RDWR);
    close(g_listenFd);
    g_listenFd = -1;
  }
  std::lock_guard<std::mutex> lock(g_mutex);
  for (int seat = 1; seat <= 3; ++seat) {
    if (g_seat[seat]) host::setGamepadPort(seat, 0, 0, 0, 0, 0, 0, 0);
    g_seat[seat] = false;
    g_stream[seat] = false;
  }
  for (int fd : g_clients) shutdown(fd, SHUT_RDWR);
}

bool running() { return g_running; }

std::string statusJson() {
  std::string out = "{\"seats\":[";
  std::lock_guard<std::mutex> lock(g_mutex);
  for (int seat = 1; seat <= 3; ++seat) {
    if (seat > 1) out += ",";
    out += "{\"slot\":" + std::to_string(seat + 1) + ",\"connected\":" + (g_seat[seat] ? "true" : "false") +
           ",\"stream\":" + (g_stream[seat] ? "true" : "false") + "}";
  }
  out += "]}";
  return out;
}

}  // namespace localplay
