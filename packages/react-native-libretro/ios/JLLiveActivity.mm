#import "JLLiveActivity.h"

#import <UIKit/UIKit.h>

// Clase Swift del target de la app (@objc(JLLiveActivityBridge)); nil si no se compiló
static Class bridgeClass(void) { return NSClassFromString(@"JLLiveActivityBridge"); }

// Mini-carátula JPEG muy pequeña: los datos de una Live Activity no pueden pasar de 4 KB
static NSData *thumbnail(NSString *path) {
  if (path.length == 0) return nil;
  UIImage *image = [UIImage imageWithContentsOfFile:path];
  if (!image) return nil;
  for (NSNumber *side in @[ @56, @44, @34 ]) {
    const CGFloat s = side.doubleValue;
    UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
    format.scale = 1;
    format.opaque = YES;
    UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(s, s) format:format];
    UIImage *small = [renderer imageWithActions:^(UIGraphicsImageRendererContext *ctx) {
      [UIColor.blackColor setFill];
      UIRectFill(CGRectMake(0, 0, s, s));
      // Recorte centrado (aspect fill)
      const CGSize sz = image.size;
      const CGFloat k = fmax(s / fmax(sz.width, 1), s / fmax(sz.height, 1));
      const CGSize d = CGSizeMake(sz.width * k, sz.height * k);
      [image drawInRect:CGRectMake((s - d.width) / 2, (s - d.height) / 2, d.width, d.height)];
    }];
    for (NSNumber *q in @[ @0.6, @0.45, @0.3 ]) {
      NSData *jpeg = UIImageJPEGRepresentation(small, q.doubleValue);
      if (jpeg && jpeg.length <= 1400) return jpeg;
    }
  }
  return nil;
}

@implementation JLLiveActivity

+ (BOOL)available {
  Class cls = bridgeClass();
  SEL sel = NSSelectorFromString(@"available");
  if (!cls || ![cls respondsToSelector:sel]) return NO;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
  id result = [cls performSelector:sel];
#pragma clang diagnostic pop
  return [result isKindOfClass:NSNumber.class] && [result boolValue];
}

+ (void)call:(NSString *)name with:(NSDictionary *)info {
  Class cls = bridgeClass();
  SEL sel = NSSelectorFromString(name);
  if (!cls || ![cls respondsToSelector:sel]) return;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
  [cls performSelector:sel withObject:info];
#pragma clang diagnostic pop
}

+ (void)start:(NSDictionary *)info {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSMutableDictionary *payload = [info mutableCopy];
    NSData *cover = thumbnail(info[@"coverPath"]);
    if (cover) payload[@"cover"] = cover;
    [payload removeObjectForKey:@"coverPath"];
    dispatch_async(dispatch_get_main_queue(), ^{
      [self call:@"start:" with:payload];
    });
  });
}

+ (void)update:(NSDictionary *)info {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self call:@"update:" with:info];
  });
}

+ (void)end {
  dispatch_async(dispatch_get_main_queue(), ^{
    Class cls = bridgeClass();
    SEL sel = NSSelectorFromString(@"end");
    if (!cls || ![cls respondsToSelector:sel]) return;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    [cls performSelector:sel];
#pragma clang diagnostic pop
  });
}

@end
