#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Taptic Engine del iPhone con Core Haptics: clic mecánico seco (A/B/X/Y), resistencia suave
// (gatillos L/R), toque de cruceta y vibración Rumble del núcleo cuando no hay mando que vibre.
@interface JLHaptics : NSObject

+ (instancetype)shared;

/** 'click' | 'trigger' | 'dpad' | 'soft' | 'success'. Sin Core Haptics usa UIImpactFeedbackGenerator. */
- (void)play:(NSString *)kind;

/** Rumble continuo en el iPhone (0 = parar). Lo llama GamepadBridge si el mando no vibra. */
- (void)rumble:(float)intensity sharpness:(float)sharpness;

@property (nonatomic) BOOL phoneRumbleEnabled;

@end

NS_ASSUME_NONNULL_END
