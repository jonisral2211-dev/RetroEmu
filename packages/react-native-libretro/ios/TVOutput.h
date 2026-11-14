#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// Modo TV: cuando hay una segunda pantalla (HDMI o AirPlay/Duplicar pantalla), el juego se
// dibuja a pantalla completa en una ventana propia sobre esa pantalla, sin interfaz encima.
@interface TVOutput : NSObject

+ (instancetype)shared;

/** Empieza a observar conexiones de pantallas (idempotente). Hilo principal. */
- (void)start;

/** {connected, name, width, height} de la pantalla externa. Seguro desde cualquier hilo. */
- (NSDictionary *)status;

/** Opciones de imagen en la TV y si hay partida (sin partida se muestra la portada JL). */
- (void)setStretch:(BOOL)stretch smooth:(BOOL)smooth playing:(BOOL)playing;

/** Abre el selector nativo de AirPlay (AVRoutePickerView). */
- (void)showRoutePicker;

@end

NS_ASSUME_NONNULL_END
