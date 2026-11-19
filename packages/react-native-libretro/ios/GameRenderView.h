#import <MetalKit/MetalKit.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// Dibuja el frame actual del núcleo con Metal (letterbox con el aspecto del core, sharp-bilinear
// en 2D o bilineal + realce en 3D). Reutilizable: vista de React y ventana de la TV.
@interface GameRenderView : UIView
@property (nonatomic) BOOL linearFilter;  // true = juego 3D (bilineal + realce)
@property (nonatomic) BOOL stretch;       // true = "Expandir": ocupa toda la vista
/** 0 = frame completo, 1 = mitad superior, 2 = mitad inferior (pantallas de la DS por separado). */
@property (atomic) NSInteger region;
/** NO detiene el dibujo (p. ej. iPhone mientras el juego sale por la TV). */
- (void)setRendering:(BOOL)rendering;
@end

@interface GameRenderView (ProShader)
/** Para todas las vistas: shader (0 según filtro, 3 CRT, 4 LCD), suavizado de bordes y nitidez CAS
 *  (0..1) y color (0 Normal, 1 Vívido, 2 Cine). En vivo. */
+ (void)setProShader:(uint32_t)mode smooth:(float)smooth cas:(float)cas color:(uint32_t)color;
@end

NS_ASSUME_NONNULL_END
