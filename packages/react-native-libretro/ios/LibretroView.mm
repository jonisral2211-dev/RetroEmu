#import <MetalKit/MetalKit.h>
#import <React/RCTComponentViewProtocol.h>
#import <React/RCTViewComponentView.h>
#import <react/renderer/components/RNLibretroSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNLibretroSpec/Props.h>
#import <react/renderer/components/RNLibretroSpec/RCTComponentViewHelpers.h>

#import "GameRenderView.h"

using namespace facebook::react;

@interface LibretroView : RCTViewComponentView
@end

// Componente Fabric: envoltorio de GameRenderView con las props filter/stretch
@implementation LibretroView {
  GameRenderView *_render;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<LibretroViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _render = [[GameRenderView alloc] initWithFrame:self.bounds];
    _render.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [self addSubview:_render];
    self.backgroundColor = UIColor.blackColor;
  }
  return self;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps {
  const auto &newProps = static_cast<const LibretroViewProps &>(*props);
  _render.linearFilter = newProps.filter ? YES : NO;
  _render.stretch = newProps.stretch ? YES : NO;
  _render.region = newProps.region;
  [super updateProps:props oldProps:oldProps];
}

@end

// Fabric registra el componente llamando a esta función (generada por codegen/autolinking).
extern "C" Class<RCTComponentViewProtocol> LibretroViewCls(void) {
  return LibretroView.class;
}
