#import "TVOutput.h"

#import <AVFoundation/AVFoundation.h>
#import <AVKit/AVKit.h>

#import "GameRenderView.h"

@implementation TVOutput {
  UIWindow *_window;
  GameRenderView *_render;
  UIView *_idleView;
  BOOL _started;
  BOOL _stretch;
  BOOL _smooth;
  BOOL _playing;
  NSInteger _region;
  // Copia del estado para leerla desde el hilo de JS sin tocar UIKit
  NSDictionary *_status;
  AVRoutePickerView *_picker;
}

+ (instancetype)shared {
  static TVOutput *shared;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    shared = [TVOutput new];
  });
  return shared;
}

- (instancetype)init {
  if (self = [super init]) {
    _status = @{@"connected" : @NO, @"name" : @"", @"width" : @0, @"height" : @0};
  }
  return self;
}

- (void)start {
  if (_started) return;
  _started = YES;
  NSNotificationCenter *nc = NSNotificationCenter.defaultCenter;
  [nc addObserver:self selector:@selector(screensChanged:) name:UIScreenDidConnectNotification object:nil];
  [nc addObserver:self selector:@selector(screensChanged:) name:UIScreenDidDisconnectNotification object:nil];
  if (@available(iOS 13.0, *)) {
    [nc addObserver:self selector:@selector(screensChanged:) name:UISceneWillConnectNotification object:nil];
    [nc addObserver:self selector:@selector(screensChanged:) name:UISceneDidDisconnectNotification object:nil];
  }
  [self screensChanged:nil];
}

- (UIScreen *)externalScreen {
  // Solo con una pantalla real conectada (HDMI / Duplicar pantalla): con una sola nunca es modo TV
  if (UIScreen.screens.count < 2) return nil;
  for (UIScreen *screen in UIScreen.screens) {
    if (screen != UIScreen.mainScreen) return screen;
  }
  return nil;
}

- (void)screensChanged:(NSNotification *)note {
  UIScreen *screen = [self externalScreen];
  if (screen && !_window) {
    [self attachTo:screen];
  } else if (!screen && _window) {
    _window.hidden = YES;
    _window = nil;
    _render = nil;
    _idleView = nil;
  }
  [self publishStatus:screen];
}

- (void)publishStatus:(UIScreen *)screen {
  const CGSize px = screen ? screen.nativeBounds.size : CGSizeZero;
  NSString *name = @"";
  if (screen) name = screen.mirroredScreen ? @"Duplicado de pantalla" : @"Pantalla externa";
  @synchronized(self) {
    _status = @{
      @"connected" : @(screen != nil),
      @"name" : name,
      @"width" : @(px.width),
      @"height" : @(px.height),
    };
  }
}

// Ruta de audio actual: AirPlay solo de sonido (sin Duplicar pantalla) NO es una pantalla externa.
// El modo TV / mando depende únicamente de UIScreen; esto solo sirve para avisar al usuario.
static NSDictionary *audioRouteInfo(void) {
  BOOL airplay = NO;
  NSString *name = @"";
  for (AVAudioSessionPortDescription *out in AVAudioSession.sharedInstance.currentRoute.outputs) {
    if ([out.portType isEqualToString:AVAudioSessionPortAirPlay]) {
      airplay = YES;
      name = out.portName ?: @"";
    }
  }
  return @{@"audioAirPlay" : @(airplay), @"audioRoute" : name};
}

- (NSDictionary *)status {
  NSDictionary *screen;
  @synchronized(self) {
    screen = _status;
  }
  NSMutableDictionary *merged = [screen mutableCopy];
  [merged addEntriesFromDictionary:audioRouteInfo()];
  return merged;
}

- (void)attachTo:(UIScreen *)screen {
  // Máxima resolución que ofrece la TV y sin bordes de compensación de overscan
  if (screen.preferredMode) screen.currentMode = screen.preferredMode;
  screen.overscanCompensation = UIScreenOverscanCompensationNone;

  UIWindow *window = nil;
  if (@available(iOS 13.0, *)) {
    // Con escenas, la pantalla externa llega como su propia UIWindowScene
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if ([scene isKindOfClass:UIWindowScene.class] && ((UIWindowScene *)scene).screen == screen) {
        window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
        break;
      }
    }
  }
  if (!window) {
    window = [[UIWindow alloc] initWithFrame:screen.bounds];
    window.screen = screen;
  }
  window.frame = screen.bounds;
  window.backgroundColor = UIColor.blackColor;
  UIViewController *vc = [UIViewController new];
  vc.view.backgroundColor = UIColor.blackColor;

  _render = [[GameRenderView alloc] initWithFrame:vc.view.bounds];
  _render.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  _render.stretch = _stretch;
  _render.linearFilter = _smooth;
  _render.region = _region;
  [vc.view addSubview:_render];

  // Portada mientras no hay partida: monograma dorado
  _idleView = [[UIView alloc] initWithFrame:vc.view.bounds];
  _idleView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  _idleView.backgroundColor = [UIColor colorWithRed:0.05 green:0.055 blue:0.07 alpha:1];
  UILabel *title = [UILabel new];
  title.text = @"JL EMULATOR";
  title.font = [UIFont systemFontOfSize:64 weight:UIFontWeightHeavy];
  title.textColor = [UIColor colorWithRed:0.83 green:0.69 blue:0.22 alpha:1];
  UILabel *subtitle = [UILabel new];
  subtitle.text = @"Modo TV · elige un juego en el iPhone";
  subtitle.font = [UIFont systemFontOfSize:24 weight:UIFontWeightMedium];
  subtitle.textColor = [UIColor colorWithWhite:0.75 alpha:1];
  UIStackView *stack = [[UIStackView alloc] initWithArrangedSubviews:@[ title, subtitle ]];
  stack.axis = UILayoutConstraintAxisVertical;
  stack.alignment = UIStackViewAlignmentCenter;
  stack.spacing = 12;
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [_idleView addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [stack.centerXAnchor constraintEqualToAnchor:_idleView.centerXAnchor],
    [stack.centerYAnchor constraintEqualToAnchor:_idleView.centerYAnchor],
  ]];
  [vc.view addSubview:_idleView];
  _idleView.hidden = _playing;
  [_render setRendering:_playing];

  window.rootViewController = vc;
  window.hidden = NO;
  _window = window;
}

- (void)setRegion:(NSInteger)region {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_region = region;
    self->_render.region = region;
  });
}

- (void)setStretch:(BOOL)stretch smooth:(BOOL)smooth playing:(BOOL)playing {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_stretch = stretch;
    self->_smooth = smooth;
    self->_playing = playing;
    self->_render.stretch = stretch;
    self->_render.linearFilter = smooth;
    [self->_render setRendering:playing];
    self->_idleView.hidden = playing;
  });
}

- (void)showRoutePicker {
  dispatch_async(dispatch_get_main_queue(), ^{
    // AVRoutePickerView no tiene API para abrirse: se pulsa su botón interno
    if (!self->_picker) {
      self->_picker = [[AVRoutePickerView alloc] initWithFrame:CGRectMake(0, 0, 44, 44)];
      if (@available(iOS 13.0, *)) self->_picker.prioritizesVideoDevices = YES;
      self->_picker.alpha = 0.011;
    }
    UIWindow *key = nil;
    for (UIWindow *w in UIApplication.sharedApplication.windows) {
      if (w.isKeyWindow) key = w;
    }
    if (!key) key = UIApplication.sharedApplication.windows.firstObject;
    if (!key) return;
    if (self->_picker.superview != key) [key addSubview:self->_picker];
    for (UIView *sub in self->_picker.subviews) {
      if ([sub isKindOfClass:UIButton.class]) {
        [(UIButton *)sub sendActionsForControlEvents:UIControlEventTouchUpInside];
        return;
      }
    }
  });
}

@end
