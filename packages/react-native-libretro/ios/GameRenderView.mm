#import "GameRenderView.h"

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
    @"struct Params { float2 texSize; float2 outSize; uint mode; float sharpen; };\n"
    @"fragment float4 libretro_fs(VOut v [[stage_in]],\n"
    @"                            texture2d<float> tex [[texture(0)]],\n"
    @"                            sampler s [[sampler(0)]],\n"
    @"                            constant Params &P [[buffer(0)]]) {\n"
    @"  if (P.mode == 0u) {\n"
    @"    float2 texel = v.uv * P.texSize;\n"
    @"    float2 scale = max(P.outSize / P.texSize, float2(1.0));\n"
    @"    float2 base = floor(texel);\n"
    @"    float2 d = fract(texel) - 0.5;\n"
    @"    float2 range = 0.5 - 0.5 / scale;\n"
    @"    float2 f = (d - clamp(d, -range, range)) * scale + 0.5;\n"
    @"    return float4(tex.sample(s, (base + f) / P.texSize).rgb, 1.0);\n"
    @"  }\n"
    @"  float2 px = 1.0 / P.texSize;\n"
    @"  float3 c = tex.sample(s, v.uv).rgb;\n"
    @"  float3 blur = 0.25 * (tex.sample(s, v.uv + float2(px.x, 0.0)).rgb +\n"
    @"                        tex.sample(s, v.uv - float2(px.x, 0.0)).rgb +\n"
    @"                        tex.sample(s, v.uv + float2(0.0, px.y)).rgb +\n"
    @"                        tex.sample(s, v.uv - float2(0.0, px.y)).rgb);\n"
    @"  return float4(clamp(c + (c - blur) * P.sharpen, 0.0, 1.0), 1.0);\n"
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
};

static const NSUInteger kTextureRing = 3;

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

#pragma mark - MTKViewDelegate

- (void)mtkView:(MTKView *)view drawableSizeWillChange:(CGSize)size {
}

- (void)drawInMTKView:(MTKView *)view {
  FrameBuffer &frame = host::frame();

  // Subir el frame nuevo (si lo hay) bajo el mutex del productor
  {
    std::lock_guard<std::mutex> lock(frame.mutex);
    // bytesPerRow = stride real del buffer BGRA8 (width*4), comprobado contra el tamaño
    if (frame.width > 0 && frame.version != _uploadedVersion &&
        frame.stride == size_t(frame.width) * 4 &&
        frame.pixels.size() >= frame.stride * frame.height) {
      _ringIndex = (_ringIndex + 1) % kTextureRing;
      id<MTLTexture> tex = _textures[_ringIndex];
      if (!tex || tex.width != frame.width || tex.height != frame.height) {
        MTLTextureDescriptor *d =
            [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                               width:frame.width
                                                              height:frame.height
                                                           mipmapped:NO];
        d.usage = MTLTextureUsageShaderRead;
        tex = [_device newTextureWithDescriptor:d];
        _textures[_ringIndex] = tex;
      }
      MTLRegion region = MTLRegionMake2D(0, 0, frame.width, frame.height);
      [tex replaceRegion:region mipmapLevel:0 withBytes:frame.pixels.data() bytesPerRow:frame.stride];
      _texture = tex;
      _uploadedVersion = frame.version;
    }
  }

  id<CAMetalDrawable> drawable = view.currentDrawable;
  MTLRenderPassDescriptor *pass = view.currentRenderPassDescriptor;
  if (!drawable || !pass || !_texture || !_pipeline) return;

  // Letterbox con la relación de aspecto que declara el core (PS1 usa píxeles no cuadrados:
  // 368x480 se ve 4:3, no 368:480). "Expandir" ocupa toda la vista. Origen y tamaño en
  // píxeles enteros: un origen fraccionario desplaza la rejilla de muestreo y produce una
  // columna desplazada en el borde izquierdo.
  const CGSize drawSize = view.drawableSize;
  const double tw = _texture.width;
  const double th = _texture.height;
  double aspect = host::aspectRatio();
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
                          self.linearFilter ? 1u : 0u, 0.35f };

  id<MTLCommandBuffer> cmd = [_commandQueue commandBuffer];
  id<MTLRenderCommandEncoder> enc = [cmd renderCommandEncoderWithDescriptor:pass];
  [enc setViewport:viewport];
  [enc setRenderPipelineState:_pipeline];
  [enc setFragmentTexture:_texture atIndex:0];
  // Ambos modos parten de muestreo lineal: el shader decide cuánto mezclar
  [enc setFragmentSamplerState:_linearSampler atIndex:0];
  [enc setFragmentBytes:&params length:sizeof(params) atIndex:0];
  [enc drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:3];
  [enc endEncoding];
  [cmd presentDrawable:drawable];
  [cmd commit];
}

@end
