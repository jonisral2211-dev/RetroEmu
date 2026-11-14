#import <MetalKit/MetalKit.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// Dibuja el frame actual del núcleo con Metal (letterbox con el aspecto del core, sharp-bilinear
// en 2D o bilineal + realce en 3D). Reutilizable: vista de React y ventana de la TV.
@interface GameRenderView : UIView
@property (nonatomic) BOOL linearFilter;  // true = juego 3D (bilineal + realce)
@property (nonatomic) BOOL stretch;       // true = "Expandir": ocupa toda la vista
/** NO detiene el dibujo (p. ej. iPhone mientras el juego sale por la TV). */
- (void)setRendering:(BOOL)rendering;
@end

NS_ASSUME_NONNULL_END
