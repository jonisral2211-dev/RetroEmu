#import <MetalKit/MetalKit.h>
#import <React/RCTComponentViewProtocol.h>
#import <React/RCTViewComponentView.h>
#import <react/renderer/components/RNLibretroSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNLibretroSpec/Props.h>
#import <react/renderer/components/RNLibretroSpec/RCTComponentViewHelpers.h>

#include <mutex>

#include "LibretroHost.hpp"

using namespace facebook::react;

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
    @"fragment float4 libretro_fs(VOut v [[stage_in]],\n"
    @"                            texture2d<float> tex [[texture(0)]],\n"
    @"                            sampler s [[sampler(0)]]) {\n"
    @"  return tex.sample(s, v.uv);\n"
    @"}\n";

@interface LibretroView : RCTViewComponentView
@end

@interface LibretroView () <MTKViewDelegate>
@end

@implementation LibretroView {
  MTKView *_mtkView;
  id<MTLDevice> _device;
  id<MTLCommandQueue> _commandQueue;
  id<MTLRenderPipelineState> _pipeline;
  id<MTLSamplerState> _nearestSampler;
  id<MTLSamplerState> _linearSampler;
  id<MTLTexture> _texture;
  uint32_t _uploadedVersion;
  BOOL _linearFilter;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<LibretroViewComponentDescriptor>();
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

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps {
  const auto &newProps = static_cast<const LibretroViewProps &>(*props);
  _linearFilter = newProps.filter ? YES : NO;
  [super updateProps:props oldProps:oldProps];
}

- (void)buildPipeline {
  NSError *error = nil;
  id<MTLLibrary> library = [_device newLibraryWithSource:kShaderSource options:nil error:&error];
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
  d.sAddressMode = MTLSamplerAddressModeClampToEdge;
  d.tAddressMode = MTLSamplerAddressModeClampToEdge;
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
    if (frame.width > 0 && frame.version != _uploadedVersion) {
      if (!_texture || _texture.width != frame.width || _texture.height != frame.height) {
        MTLTextureDescriptor *d =
            [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                               width:frame.width
                                                              height:frame.height
                                                           mipmapped:NO];
        d.usage = MTLTextureUsageShaderRead;
        _texture = [_device newTextureWithDescriptor:d];
      }
      MTLRegion region = MTLRegionMake2D(0, 0, frame.width, frame.height);
      [_texture replaceRegion:region
                  mipmapLevel:0
                    withBytes:frame.pixels.data()
                  bytesPerRow:size_t(frame.width) * 4];
      _uploadedVersion = frame.version;
    }
  }

  id<CAMetalDrawable> drawable = view.currentDrawable;
  MTLRenderPassDescriptor *pass = view.currentRenderPassDescriptor;
  if (!drawable || !pass || !_texture || !_pipeline) return;

  // Letterbox: escala uniforme que encaja en la vista, centrada
  const CGSize drawSize = view.drawableSize;
  const double tw = _texture.width;
  const double th = _texture.height;
  const double scale = MIN(drawSize.width / tw, drawSize.height / th);
  const double vw = tw * scale;
  const double vh = th * scale;
  MTLViewport viewport = { (drawSize.width - vw) / 2.0, (drawSize.height - vh) / 2.0,
                           vw, vh, 0.0, 1.0 };

  id<MTLCommandBuffer> cmd = [_commandQueue commandBuffer];
  id<MTLRenderCommandEncoder> enc = [cmd renderCommandEncoderWithDescriptor:pass];
  [enc setViewport:viewport];
  [enc setRenderPipelineState:_pipeline];
  [enc setFragmentTexture:_texture atIndex:0];
  [enc setFragmentSamplerState:(_linearFilter ? _linearSampler : _nearestSampler) atIndex:0];
  [enc drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:3];
  [enc endEncoding];
  [cmd presentDrawable:drawable];
  [cmd commit];
}

@end

// Fabric registra el componente llamando a esta función (generada por codegen/autolinking).
extern "C" Class<RCTComponentViewProtocol> LibretroViewCls(void) {
  return LibretroView.class;
}
