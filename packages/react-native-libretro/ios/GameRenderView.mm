#import "GameRenderView.h"

#include <algorithm>
#include <mutex>
#include <simd/simd.h>

#include "LibretroHost.hpp"

// Triángulo que cubre la pantalla + muestreo de la textura. Fuente en MSL embebida,
// así no hace falta un build phase para .metal.
static NSString *const kShaderSource =
    @"#include <metal_stdlib>\n"
    @"using namespace metal;\n"
    @"struct VOut { float4 position [[position]]; float2 uv; };\n"
    @"vertex VOut libretro_vs(uint vid [[vertex_id]]) {\n"
    @"  float2 p = float2((vid << 1) & 2, vid & 2);\n"
    @"  VOut o;\n"
    @"  o.position = float4(p * 2.0 - 1.0, 0.0, 1.0);\n"
    @"  o.uv = float2(p.x, 1.0 - p.y);\n"
    @"  return o;\n"
    @"}\n"
    // texSize = tamaño de la textura en texels; outSize = tamaño del viewport en píxeles.
    // mode 0 (2D): "sharp bilinear". Nearest dentro de cada texel y mezcla lineal solo en la
    //   franja de 1 píxel de pantalla entre texels: bordes nítidos sin dientes desiguales a
    //   escala no entera en pantallas Retina.
    // mode 1 (3D): bilineal + realce de nitidez suave (unsharp mask de 5 muestras).
    @"struct Params { float2 texSize; float2 outSize; uint mode; float sharpen; float smooth; uint color; float cas; };\n"
    @"float lumaOf(float3 c) { return dot(c, float3(0.299, 0.587, 0.114)); }\n"
    @"// \"Sharp bilinear\": nearest dentro del texel y mezcla solo en la franja de 1 píxel de pantalla\n"
    @"float3 sharpSample(texture2d<float> tex, sampler s, float2 uv, constant Params &P) {\n"
    @"  float2 texel = uv * P.texSize;\n"
    @"  float2 scale = max(P.outSize / P.texSize, float2(1.0));\n"
    @"  float2 base = floor(texel);\n"
    @"  float2 d = fract(texel) - 0.5;\n"
    @"  float2 range = 0.5 - 0.5 / scale;\n"
    @"  float2 f = (d - clamp(d, -range, range)) * scale + 0.5;\n"
    @"  return tex.sample(s, (base + f) / P.texSize).rgb;\n"
    @"}\n"
    @"// Suavizado de bordes tipo xBR/ScaleFX ligero: en un bloque de 2x2 texels busca la diagonal\n"
    @"// más parecida y redondea los escalones solo allí; las zonas planas y los detalles internos\n"
    @"// (ojos, texto) quedan con transición corta\n"
    @"float3 edgeSmooth(texture2d<float> tex, sampler s, float2 uv, constant Params &P) {\n"
    @"  float2 t = uv * P.texSize - 0.5;\n"
    @"  float2 b = floor(t);\n"
    @"  float2 f = fract(t);\n"
    @"  float2 px = 1.0 / P.texSize;\n"
    @"  float3 tl = tex.sample(s, (b + float2(0.5, 0.5)) * px).rgb;\n"
    @"  float3 tr = tex.sample(s, (b + float2(1.5, 0.5)) * px).rgb;\n"
    @"  float3 bl = tex.sample(s, (b + float2(0.5, 1.5)) * px).rgb;\n"
    @"  float3 br = tex.sample(s, (b + float2(1.5, 1.5)) * px).rgb;\n"
    @"  float2 g = smoothstep(float2(0.25), float2(0.75), f);\n"
    @"  float3 soft = mix(mix(tl, tr, g.x), mix(bl, br, g.x), g.y);\n"
    @"  float dMain = abs(lumaOf(tl) - lumaOf(br));\n"
    @"  float dAnti = abs(lumaOf(tr) - lumaOf(bl));\n"
    @"  if (abs(dMain - dAnti) < 0.05) return soft;\n"
    @"  float3 diag;\n"
    @"  if (dMain < dAnti) {\n"
    @"    // tl-br forman la línea: el lado del corte sigue a tr o bl\n"
    @"    float side = f.x - f.y;\n"
    @"    float3 corner = side > 0.0 ? tr : bl;\n"
    @"    diag = mix(0.5 * (tl + br), corner, smoothstep(0.15, 0.6, abs(side)));\n"
    @"  } else {\n"
    @"    float side = f.x + f.y - 1.0;\n"
    @"    float3 corner = side > 0.0 ? br : tl;\n"
    @"    diag = mix(0.5 * (tr + bl), corner, smoothstep(0.15, 0.6, abs(side)));\n"
    @"  }\n"
    @"  return diag;\n"
    @"}\n"
    @"// TV CRT Trinitron: líneas de escaneo, rejilla de apertura RGB, brillo de fósforo y viñeta\n"
    @"float3 crt(texture2d<float> tex, sampler s, float2 uv, float2 frag, constant Params &P) {\n"
    @"  float2 texel = uv * P.texSize;\n"
    @"  float3 c = tex.sample(s, (floor(texel) + float2(fract(texel.x), 0.5)) / P.texSize).rgb;\n"
    @"  c = pow(c, float3(2.2));\n"
    @"  float scan = sin(3.14159 * fract(texel.y));\n"
    @"  float beam = mix(0.55, 1.0, pow(scan, mix(2.2, 0.8, lumaOf(c))));\n"
    @"  int col = int(fmod(frag.x, 3.0));\n"
    @"  float3 mask = col == 0 ? float3(1.0, 0.78, 0.78) : col == 1 ? float3(0.78, 1.0, 0.78) : float3(0.78, 0.78, 1.0);\n"
    @"  c *= beam * mask * 1.38;\n"
    @"  float2 v = uv - 0.5;\n"
    @"  c *= 1.0 - dot(v, v) * 0.55;\n"
    @"  return pow(clamp(c, 0.0, 1.0), float3(1.0 / 2.2));\n"
    @"}\n"
    @"// Pantalla portátil LCD: rejilla entre píxeles y subpíxeles RGB (solo si hay sitio: >= 3 px)\n"
    @"float3 lcd(texture2d<float> tex, sampler s, float2 uv, constant Params &P) {\n"
    @"  float2 texel = uv * P.texSize;\n"
    @"  float3 c = tex.sample(s, (floor(texel) + 0.5) / P.texSize).rgb;\n"
    @"  float2 cell = fract(texel);\n"
    @"  float2 scale = P.outSize / P.texSize;\n"
    @"  bool room = min(scale.x, scale.y) >= 3.0;\n"
    @"  float gw = room ? 1.0 / min(scale.x, scale.y) : 0.0;\n"
    @"  float grid = (cell.x < gw || cell.y < gw) ? 0.72 : 1.0;\n"
    @"  int sub = int(cell.x * 3.0);\n"
    @"  float3 tint = sub == 0 ? float3(1.0, 0.86, 0.86) : sub == 1 ? float3(0.86, 1.0, 0.86) : float3(0.86, 0.86, 1.0);\n"
    @"  return clamp(c * grid * (room ? tint : float3(1.0)) * 1.08, 0.0, 1.0);\n"
    @"}\n"
    @"// Color: 1 = Vívido (HDR simulado: más saturación y curva S), 2 = Cine clásico (cálido y suave)\n"
    @"float3 grade(float3 c, uint mode) {\n"
    @"  if (mode == 1u) {\n"
    @"    float l = lumaOf(c);\n"
    @"    c = mix(float3(l), c, 1.28);\n"
    @"    c = c * c * (3.0 - 2.0 * c) * 0.35 + c * 0.65;\n"
    @"    return clamp(c * 1.04, 0.0, 1.0);\n"
    @"  }\n"
    @"  if (mode == 2u) {\n"
    @"    float l = lumaOf(c);\n"
    @"    c = mix(float3(l), c, 0.85);\n"
    @"    c = c * float3(1.06, 1.0, 0.9) * 0.94 + 0.03;\n"
    @"    return clamp(c, 0.0, 1.0);\n"
    @"  }\n"
    @"  return c;\n"
    @"}\n"
    @"fragment float4 libretro_fs(VOut v [[stage_in]],\n"
    @"                            texture2d<float> tex [[texture(0)]],\n"
    @"                            sampler s [[sampler(0)]],\n"
    @"                            constant Params &P [[buffer(0)]]) {\n"
    @"  float3 c;\n"
    @"  float2 px = 1.0 / P.texSize;\n"
    @"  if (P.mode == 3u) {\n"
    @"    c = crt(tex, s, v.uv, v.position.xy, P);\n"
    @"  } else if (P.mode == 4u) {\n"
    @"    c = lcd(tex, s, v.uv, P);\n"
    @"  } else if (P.mode == 1u) {\n"
    @"    // 3D: bilineal + realce suave\n"
    @"    c = tex.sample(s, v.uv).rgb;\n"
    @"    float3 blur = 0.25 * (tex.sample(s, v.uv + float2(px.x, 0.0)).rgb + tex.sample(s, v.uv - float2(px.x, 0.0)).rgb +\n"
    @"                          tex.sample(s, v.uv + float2(0.0, px.y)).rgb + tex.sample(s, v.uv - float2(0.0, px.y)).rgb);\n"
    @"    c = clamp(c + (c - blur) * P.sharpen, 0.0, 1.0);\n"
    @"  } else {\n"
    @"    // 2D: píxel perfecto mezclado con el suavizado de bordes según el deslizador (0..1)\n"
    @"    c = sharpSample(tex, s, v.uv, P);\n"
    @"    if (P.smooth > 0.001) c = mix(c, edgeSmooth(tex, s, v.uv, P), P.smooth);\n"
    @"  }\n"
    @"  if (P.cas > 0.001 && P.mode != 3u && P.mode != 4u) {\n"
    @"    // Nitidez adaptativa (tipo CAS): fuerte en zonas de poco contraste, suave en bordes duros\n"
    @"    float3 n = tex.sample(s, v.uv + float2(0.0, -px.y)).rgb;\n"
    @"    float3 so = tex.sample(s, v.uv + float2(0.0, px.y)).rgb;\n"
    @"    float3 e = tex.sample(s, v.uv + float2(px.x, 0.0)).rgb;\n"
    @"    float3 w = tex.sample(s, v.uv + float2(-px.x, 0.0)).rgb;\n"
    @"    float3 mn = min(min(min(n, so), min(e, w)), c);\n"
    @"    float3 mx = max(max(max(n, so), max(e, w)), c);\n"
    @"    float3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, float3(0.0001)), 0.0, 1.0));\n"
    @"    float3 wgt = -amp * mix(0.125, 0.2, P.cas);\n"
    @"    c = clamp((c + (n + so + e + w) * wgt) / (1.0 + 4.0 * wgt), 0.0, 1.0);\n"
    @"  }\n"
    @"  return float4(grade(c, P.color), 1.0);\n"
    @"}\n";

// Respaldo si el shader principal no compila en algún dispositivo: muestreo directo
static NSString *const kFallbackShaderSource =
    @"#include <metal_stdlib>\n"
    @"using namespace metal;\n"
    @"struct VOut { float4 position [[position]]; float2 uv; };\n"
    @"vertex VOut libretro_vs(uint vid [[vertex_id]]) {\n"
    @"  float2 p = float2((vid << 1) & 2, vid & 2);\n"
    @"  VOut o;\n"
    @"  o.position = float4(p * 2.0 - 1.0, 0.0, 1.0);\n"
    @"  o.uv = float2(p.x, 1.0 - p.y);\n"
    @"  return o;\n"
    @"}\n"
    @"fragment float4 libretro_fs(VOut v [[stage_in]], texture2d<float> tex [[texture(0)]],\n"
    @"                            sampler s [[sampler(0)]]) {\n"
    @"  return tex.sample(s, v.uv);\n"
    @"}\n";

// Debe coincidir con `struct Params` del shader
struct ShaderParams {
  simd_float2 texSize;
  simd_float2 outSize;
  uint32_t mode;
  float sharpen;
  float smooth;
  uint32_t color;
  float cas;
};

static const NSUInteger kTextureRing = 3;

// Ajustes de imagen del menú (comunes al iPhone y a la TV, se aplican en vivo cada frame):
// shader 0 = según el filtro (Nítido / Suavizado), 3 = CRT, 4 = LCD; suavizado de bordes y
// nitidez CAS 0..1; color 0 Normal, 1 Vívido, 2 Cine
// MetalFX (iOS 16+): se compila solo si el SDK lo trae; en iOS 15 o sin soporte no hace nada
#if __has_include(<MetalFX/MetalFX.h>)
#import <MetalFX/MetalFX.h>
#define JL_HAS_METALFX 1
#endif

// 0 apagado, 1 HD (tope 1080p), 2 4K (tope 2160p)
static uint32_t g_metalFX = 0;

static uint32_t g_proShader = 0;
static float g_smooth = 0.0f;
static float g_cas = 0.0f;
static uint32_t g_color = 0;

@implementation GameRenderView (ProShader)
+ (void)setProShader:(uint32_t)mode smooth:(float)smooth cas:(float)cas color:(uint32_t)color {
  g_proShader = mode;
  g_smooth = std::min(1.0f, std::max(0.0f, smooth));
  g_cas = std::min(1.0f, std::max(0.0f, cas));
  g_color = color;
}
@end

@implementation GameRenderView (MetalFX)
+ (void)setMetalFX:(uint32_t)mode {
  g_metalFX = mode > 2 ? 0 : mode;
}
@end

@interface GameRenderView () <MTKViewDelegate>
@end

// Vista Metal que dibuja el último frame del core. La usan la vista de React (iPhone) y la
// ventana de la pantalla externa (TV): cada una sube su propia textura cuando cambia la versión.
@implementation GameRenderView {
  MTKView *_mtkView;
  id<MTLDevice> _device;
  id<MTLCommandQueue> _commandQueue;
  id<MTLRenderPipelineState> _pipeline;
  id<MTLSamplerState> _nearestSampler;
  id<MTLSamplerState> _linearSampler;
  // Anillo de texturas: nunca se reescribe (replaceRegion, CPU) una textura que un command
  // buffer anterior aún puede estar muestreando en la GPU.
  id<MTLTexture> _textures[kTextureRing];
  NSUInteger _ringIndex;
  id<MTLTexture> _texture;  // la última subida, la que se dibuja
  uint32_t _uploadedVersion;
  NSInteger _uploadedRegion;
  // MetalFX: escalador y textura de salida (se recrean solo si cambian las dimensiones)
  id _scaler;
  id<MTLTexture> _scaledTexture;
  NSUInteger _scKey[4];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _device = MTLCreateSystemDefaultDevice();
    _commandQueue = [_device newCommandQueue];

    _mtkView = [[MTKView alloc] initWithFrame:self.bounds device:_device];
    _mtkView.delegate = self;
    _mtkView.preferredFramesPerSecond = 60;
    _mtkView.enableSetNeedsDisplay = NO;  // redibuja a 60 Hz; el core no empuja draws
    _mtkView.paused = NO;
    _mtkView.framebufferOnly = YES;
    _mtkView.clearColor = MTLClearColorMake(0, 0, 0, 1);
    _mtkView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [self addSubview:_mtkView];

    self.backgroundColor = UIColor.blackColor;
    [self buildPipeline];
    [self buildSamplers];
  }
  return self;
}

// Resolución física completa de la pantalla donde se muestra (iPhone o TV): nativeScale da los
// píxeles reales del panel (en los Plus/Max, más que `scale`) y, en la TV, los de su modo
// actual (1080p o 4K). Sin esto la ventana de la TV podía dibujar a la escala del iPhone.
- (void)didMoveToWindow {
  [super didMoveToWindow];
  UIScreen *screen = self.window.windowScene.screen ?: self.window.screen ?: UIScreen.mainScreen;
  CGFloat scale = screen.nativeScale > 0 ? screen.nativeScale : screen.scale;
  if (screen != UIScreen.mainScreen && screen.currentMode && screen.bounds.size.width > 0) {
    // TV: píxeles del modo de vídeo activo / puntos de la pantalla
    scale = screen.currentMode.size.width / screen.bounds.size.width;
  }
  self.contentScaleFactor = scale;
  _mtkView.contentScaleFactor = scale;
  _mtkView.autoResizeDrawable = NO;
  [self syncLayout];
}

// Ocupa siempre el área actual de la vista (rotación, controles ocultos o mostrados) y pide un
// drawable en píxeles Retina del tamaño real: sin esto el dibujo podía quedarse en un cuarto.
- (void)layoutSubviews {
  [super layoutSubviews];
  [self syncLayout];
}

- (void)syncLayout {
  // Sin tamaño todavía (vista fuera de pantalla): no se crea ningún drawable de 0 píxeles
  if (self.bounds.size.width <= 0 || self.bounds.size.height <= 0) return;
  CGFloat scale = self.contentScaleFactor > 0 ? self.contentScaleFactor : UIScreen.mainScreen.nativeScale;
  if (scale <= 0) scale = 1;
  _mtkView.frame = self.bounds;
  _mtkView.contentScaleFactor = scale;
  CGSize px = CGSizeMake(floor(self.bounds.size.width * scale), floor(self.bounds.size.height * scale));
  if (px.width > 0 && px.height > 0 && !CGSizeEqualToSize(_mtkView.drawableSize, px)) {
    _mtkView.drawableSize = px;
  }
}

- (void)setRendering:(BOOL)rendering {
  _mtkView.paused = !rendering;
}

- (void)buildPipeline {
  NSError *error = nil;
  id<MTLLibrary> library = [_device newLibraryWithSource:kShaderSource options:nil error:&error];
  if (!library) {
    NSLog(@"[LibretroView] error compilando shaders, uso el de respaldo: %@", error);
    library = [_device newLibraryWithSource:kFallbackShaderSource options:nil error:&error];
  }
  if (!library) {
    NSLog(@"[LibretroView] error compilando shaders: %@", error);
    return;
  }
  MTLRenderPipelineDescriptor *desc = [MTLRenderPipelineDescriptor new];
  desc.vertexFunction = [library newFunctionWithName:@"libretro_vs"];
  desc.fragmentFunction = [library newFunctionWithName:@"libretro_fs"];
  desc.colorAttachments[0].pixelFormat = _mtkView.colorPixelFormat;
  _pipeline = [_device newRenderPipelineStateWithDescriptor:desc error:&error];
  if (!_pipeline) NSLog(@"[LibretroView] pipeline: %@", error);
}

- (void)buildSamplers {
  MTLSamplerDescriptor *d = [MTLSamplerDescriptor new];
  // ClampToEdge en todos los ejes: el filtro lineal no mezcla el borde izquierdo con el derecho
  d.sAddressMode = MTLSamplerAddressModeClampToEdge;
  d.tAddressMode = MTLSamplerAddressModeClampToEdge;
  d.rAddressMode = MTLSamplerAddressModeClampToEdge;
  d.normalizedCoordinates = YES;
  d.minFilter = MTLSamplerMinMagFilterNearest;
  d.magFilter = MTLSamplerMinMagFilterNearest;
  _nearestSampler = [_device newSamplerStateWithDescriptor:d];
  d.minFilter = MTLSamplerMinMagFilterLinear;
  d.magFilter = MTLSamplerMinMagFilterLinear;
  _linearSampler = [_device newSamplerStateWithDescriptor:d];
}

// Reescala el frame del core con MetalFX (espacial) hasta el tope HD o 4K, sin pasar de lo que
// cabe en la pantalla. Si el modo está apagado, el dispositivo no lo soporta o la imagen ya es
// más grande que el tope, devuelve la textura original (dibujo normal).
- (id<MTLTexture>)metalFXUpscale:(id<MTLTexture>)src drawSize:(CGSize)ds cmd:(id<MTLCommandBuffer>)cmd {
#if JL_HAS_METALFX
  if (!g_metalFX || !src || ds.width <= 0 || ds.height <= 0) return src;
  if (@available(iOS 16.0, *)) {
    if (![MTLFXSpatialScalerDescriptor supportsDevice:_device]) return src;
    const double tw = src.width, th = src.height;
    const double maxH = g_metalFX == 2 ? 2160.0 : 1080.0;
    double s = std::min(ds.width / tw, ds.height / th);
    s = std::min(s, maxH / th);
    if (s <= 1.0) return src;  // solo reescalado hacia arriba
    const NSUInteger ow = (NSUInteger)floor(tw * s), oh = (NSUInteger)floor(th * s);
    if (ow < src.width || oh < src.height) return src;
    const NSUInteger key[4] = { src.width, src.height, ow, oh };
    if (!_scaler || !_scaledTexture || memcmp(_scKey, key, sizeof(key)) != 0) {
      MTLFXSpatialScalerDescriptor *d = [MTLFXSpatialScalerDescriptor new];
      d.inputWidth = src.width;
      d.inputHeight = src.height;
      d.outputWidth = ow;
      d.outputHeight = oh;
      d.colorTextureFormat = MTLPixelFormatBGRA8Unorm;
      d.outputTextureFormat = MTLPixelFormatBGRA8Unorm;
      d.colorProcessingMode = MTLFXSpatialScalerColorProcessingModePerceptual;
      _scaler = [d newSpatialScalerWithDevice:_device];
      MTLTextureDescriptor *td = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                                                    width:ow
                                                                                   height:oh
                                                                                mipmapped:NO];
      td.usage = MTLTextureUsageShaderRead | MTLTextureUsageShaderWrite;
      td.storageMode = MTLStorageModePrivate;
      _scaledTexture = [_device newTextureWithDescriptor:td];
      memcpy(_scKey, key, sizeof(key));
    }
    if (!_scaler || !_scaledTexture) return src;
    [_scaler setColorTexture:src];
    [_scaler setOutputTexture:_scaledTexture];
    [_scaler setInputContentWidth:src.width];
    [_scaler setInputContentHeight:src.height];
    [_scaler encodeToCommandBuffer:cmd];
    return _scaledTexture;
  }
#endif
  return src;
}

#pragma mark - MTKViewDelegate

- (void)mtkView:(MTKView *)view drawableSizeWillChange:(CGSize)size {
}

- (void)drawInMTKView:(MTKView *)view {
  FrameBuffer &frame = host::frame();

  // Subir el frame nuevo (si lo hay) bajo el mutex del productor
  {
    std::lock_guard<std::mutex> lock(frame.mutex);
    // bytesPerRow = stride real del buffer BGRA8 (width*4), comprobado contra el tamaño
    // Región: 0 = frame completo; 1/2 = mitad superior/inferior (DS: pantalla de arriba en la TV
    // y pantalla táctil en el iPhone)
    const NSInteger region = self.region;
    if (frame.width > 0 && (frame.version != _uploadedVersion || region != _uploadedRegion) &&
        frame.stride == size_t(frame.width) * 4 &&
        frame.pixels.size() >= frame.stride * frame.height && (region == 0 || frame.height >= 2)) {
      const unsigned rows = region ? frame.height / 2 : frame.height;
      const uint8_t *src = frame.pixels.data() + (region == 2 ? frame.stride * (frame.height - rows) : 0);
      _ringIndex = (_ringIndex + 1) % kTextureRing;
      id<MTLTexture> tex = _textures[_ringIndex];
      if (!tex || tex.width != frame.width || tex.height != rows) {
        MTLTextureDescriptor *d =
            [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                               width:frame.width
                                                              height:rows
                                                           mipmapped:NO];
        d.usage = MTLTextureUsageShaderRead;
        tex = [_device newTextureWithDescriptor:d];
        _textures[_ringIndex] = tex;
      }
      MTLRegion area = MTLRegionMake2D(0, 0, frame.width, rows);
      [tex replaceRegion:area mipmapLevel:0 withBytes:src bytesPerRow:frame.stride];
      _texture = tex;
      _uploadedVersion = frame.version;
      _uploadedRegion = region;
    }
  }

  id<CAMetalDrawable> drawable = view.currentDrawable;
  MTLRenderPassDescriptor *pass = view.currentRenderPassDescriptor;
  if (!drawable || !pass || !_texture || !_pipeline) return;
  id<MTLCommandBuffer> cmd = [_commandQueue commandBuffer];
  // MetalFX: reescalado espacial antes del dibujo (sin cambios si está apagado o no hay soporte)
  id<MTLTexture> srcTex = [self metalFXUpscale:_texture drawSize:view.drawableSize cmd:cmd];

  // Letterbox con la relación de aspecto que declara el core (PS1 usa píxeles no cuadrados:
  // 368x480 se ve 4:3, no 368:480). "Expandir" ocupa toda la vista. Origen y tamaño en
  // píxeles enteros: un origen fraccionario desplaza la rejilla de muestreo y produce una
  // columna desplazada en el borde izquierdo.
  const CGSize drawSize = view.drawableSize;
  const double tw = srcTex.width;
  const double th = srcTex.height;
  double aspect = host::aspectRatio();
  if (aspect > 0.0 && _uploadedRegion != 0) aspect *= 2.0;  // media imagen: el doble de ancha
  if (!(aspect > 0.0)) aspect = tw / th;
  double vw = drawSize.width, vh = drawSize.height;
  if (!self.stretch) {
    if (drawSize.width / drawSize.height > aspect) {
      vw = drawSize.height * aspect;
    } else {
      vh = drawSize.width / aspect;
    }
  }
  vw = floor(vw);
  vh = floor(vh);
  MTLViewport viewport = { floor((drawSize.width - vw) / 2.0), floor((drawSize.height - vh) / 2.0),
                           vw, vh, 0.0, 1.0 };
  ShaderParams params = { simd_make_float2(float(tw), float(th)), simd_make_float2(float(vw), float(vh)),
                          g_proShader ? g_proShader : (self.linearFilter ? 1u : 0u), 0.35f,
                          g_smooth, g_color, g_cas };

  id<MTLRenderCommandEncoder> enc = [cmd renderCommandEncoderWithDescriptor:pass];
  [enc setViewport:viewport];
  [enc setRenderPipelineState:_pipeline];
  [enc setFragmentTexture:srcTex atIndex:0];
  // Ambos modos parten de muestreo lineal: el shader decide cuánto mezclar
  [enc setFragmentSamplerState:_linearSampler atIndex:0];
  [enc setFragmentBytes:&params length:sizeof(params) atIndex:0];
  [enc drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:3];
  [enc endEncoding];
  [cmd presentDrawable:drawable];
  [cmd commit];
}

@end
