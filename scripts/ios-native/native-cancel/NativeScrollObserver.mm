// Simulator qualification only. No production target or RN binary is rewritten.
#import "NativeScrollObserver.h"
#import "ScrollReceiverRuntime.h"
#import <QuartzCore/QuartzCore.h>
#import <TargetConditionals.h>
#import <fcntl.h>
#import <unistd.h>
#include <math.h>
#if !TARGET_OS_SIMULATOR
#error NativeScrollObserver is restricted to qualification simulators.
#endif

@interface HSSState : NSObject
@property NSUInteger instanceID;
@property NSUInteger gestureID;
@property(nonatomic, weak) UIScrollView *scroll;
@end
@implementation HSSState @end
static Class HSSBase, HSSObserved, HSSScrollClass;
static IMP HSSDidScroll, HSSBeginDrag, HSSEndDrag, HSSBeginDecel, HSSEndDecel, HSSEndAnimation, HSSMoveWindow;
static char HSSStateKey;
static NSUInteger HSSSequence, HSSNextInstance, HSSNextWindow, HSSNextCall;
static long long HSSEpoch;
static NSMapTable<UIWindow *, NSNumber *> *HSSWindows;

static NSNumber *HSSMilli(double value) { return isfinite(value) && fabs(value) <= 1000000 ? @(llround(value * 1000)) : nil; }
static id HSSNumber(double value) { return HSSMilli(value) ?: NSNull.null; }
static HSSState *HSSGet(id receiver) { @try { return objc_getAssociatedObject(receiver, &HSSStateKey); } @catch (__unused NSException *e) { return nil; } }

static BOOL HSSOwned(id receiver, UIScrollView *scroll) {
  @try {
    if (!NSThread.isMainThread || !HSSObserved || !receiver || !scroll) return NO;
    return HSSOwnedPair((id<HSSPairContract>)receiver, (id<HSSPairContract>)scroll, HSSBase, HSSObserved, HSSScrollClass);
  } @catch (__unused NSException *e) { return NO; }
}

static NSDictionary *HSSMetrics(UIScrollView *scroll) {
  @try {
    UIWindow *window = scroll.window;
    CGPoint offset = scroll.contentOffset; CGRect bounds = scroll.bounds; CGSize content = scroll.contentSize;
    UIEdgeInsets inset = scroll.contentInset, adjusted = scroll.adjustedContentInset;
    CGRect frame = CGRectNull, clip = CGRectNull; BOOL complete = NO;
    if (window) {
      frame = [scroll convertRect:bounds toView:window]; clip = frame;
      UIView *parent = scroll.superview;
      for (NSUInteger depth = 0; parent && depth < 24; depth++, parent = parent.superview) {
        if (parent.clipsToBounds || parent == window) clip = CGRectIntersection(clip, [parent convertRect:parent.bounds toView:window]);
        if (parent == window) { complete = YES; break; }
      }
    }
    BOOL frameKnown = !CGRectIsNull(frame) && !CGRectIsInfinite(frame);
    BOOL clipKnown = complete && !CGRectIsNull(clip) && !CGRectIsInfinite(clip);
    // Empty clipping is recorded as zero extent, never as a visible/AX claim.
    if (complete && CGRectIsNull(clip)) { clip = CGRectZero; clipKnown = YES; }
    return @{@"ox": HSSNumber(offset.x), @"oy": HSSNumber(offset.y),
      @"bx": HSSNumber(bounds.origin.x), @"by": HSSNumber(bounds.origin.y), @"bw": HSSNumber(bounds.size.width), @"bh": HSSNumber(bounds.size.height),
      @"cw": HSSNumber(content.width), @"ch": HSSNumber(content.height),
      @"it": HSSNumber(inset.top), @"il": HSSNumber(inset.left), @"ib": HSSNumber(inset.bottom), @"ir": HSSNumber(inset.right),
      @"at": HSSNumber(adjusted.top), @"al": HSSNumber(adjusted.left), @"ab": HSSNumber(adjusted.bottom), @"ar": HSSNumber(adjusted.right),
      @"fx": frameKnown ? HSSNumber(frame.origin.x) : NSNull.null, @"fy": frameKnown ? HSSNumber(frame.origin.y) : NSNull.null,
      @"fw": frameKnown ? HSSNumber(frame.size.width) : NSNull.null, @"fh": frameKnown ? HSSNumber(frame.size.height) : NSNull.null,
      @"cx": clipKnown ? HSSNumber(clip.origin.x) : NSNull.null, @"cy": clipKnown ? HSSNumber(clip.origin.y) : NSNull.null,
      @"cwidth": clipKnown ? HSSNumber(clip.size.width) : NSNull.null, @"cheight": clipKnown ? HSSNumber(clip.size.height) : NSNull.null,
      @"geometryComplete": @(complete), @"drag": @(scroll.dragging), @"decel": @(scroll.decelerating), @"tracking": @(scroll.tracking),
      @"enabled": @(scroll.scrollEnabled), @"clips": @(scroll.clipsToBounds), @"hidden": @(scroll.hidden), @"attached": @(window != nil),
      @"zoom": HSSNumber(scroll.zoomScale), @"ww": window ? HSSNumber(window.bounds.size.width) : NSNull.null,
      @"wh": window ? HSSNumber(window.bounds.size.height) : NSNull.null, @"scale": window ? HSSNumber(window.screen.scale) : NSNull.null,
      @"orientation": @(window.windowScene.interfaceOrientation)};
  } @catch (__unused NSException *e) { return nil; }
}

static void HSSWrite(NSMutableDictionary *row) {
  @try {
    if (HSSSequence > 2048) return;
    if (HSSSequence == 2048) {
      row = [row mutableCopy]; row[@"k"] = @14; row[@"phase"] = @3; row[@"instance"] = @0; row[@"window"] = @0;
      row[@"gesture"] = @0; row[@"q"] = @0; row[@"call"] = @0; row[@"metrics"] = NSNull.null; row[@"touch"] = NSNull.null;
      row[@"willDecelerate"] = @-1; row[@"code"] = @0;
    }
    row[@"v"] = @1; row[@"seq"] = @(HSSSequence++); row[@"pid"] = @(getpid()); row[@"epoch"] = @(HSSEpoch);
    NSDictionary *snapshot = [row copy]; static dispatch_queue_t queue; static dispatch_once_t once;
    dispatch_once(&once, ^{ queue = dispatch_queue_create("dev.hemsoft.native-scroll-write", DISPATCH_QUEUE_SERIAL); });
    dispatch_async(queue, ^{
      @try {
        static BOOL attempted; static NSFileHandle *handle;
        if (!attempted) {
          attempted = YES;
          NSString *documents = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
          NSString *path = documents ? [documents stringByAppendingPathComponent:[NSString stringWithFormat:@"native-scroll-%d-%lld.jsonl", getpid(), HSSEpoch]] : nil;
          int fd = path ? open(path.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600) : -1;
          if (fd >= 0) handle = [[NSFileHandle alloc] initWithFileDescriptor:fd closeOnDealloc:YES];
        }
        NSData *data = [NSJSONSerialization dataWithJSONObject:snapshot options:0 error:nil];
        if (handle && data.length <= 8192) { [handle writeData:data]; [handle writeData:[NSData dataWithBytes:"\n" length:1]]; }
      } @catch (__unused NSException *e) {}
    });
  } @catch (__unused NSException *e) {}
}

static void HSSObserve(NSInteger kind, NSInteger phase, NSUInteger call, id receiver, HSSState *state, UITouch *touch, NSUInteger nativeTouch, NSInteger decelerate, NSInteger code) {
  @try {
    if (!NSThread.isMainThread || HSSSequence > 2048) return;
    double u0 = CACurrentMediaTime(), wall = NSDate.date.timeIntervalSince1970, u1 = CACurrentMediaTime();
    UIScrollView *scroll = state.scroll; BOOL owned = state && HSSOwned(receiver, scroll);
    UIWindow *window = owned ? scroll.window : nil; NSNumber *windowID = window ? [HSSWindows objectForKey:window] : nil;
    if (window && !windowID && HSSNextWindow < 16) { windowID = @(++HSSNextWindow); [HSSWindows setObject:windowID forKey:window]; }
    NSDictionary *metrics = owned ? HSSMetrics(scroll) : nil;
    NSDictionary *point = nil;
    if (touch && window && touch.window == window) {
      CGPoint value = [touch locationInView:window]; CGPoint screen = [window convertPoint:value toCoordinateSpace:window.screen.coordinateSpace];
      point = @{@"tt": @(touch.timestamp), @"phase": @(touch.phase), @"x": HSSNumber(value.x), @"y": HSSNumber(value.y), @"sx": HSSNumber(screen.x), @"sy": HSSNumber(screen.y)};
    }
    HSSWrite([@{@"k": @(kind), @"phase": @(phase), @"call": @(call), @"instance": @(state.instanceID), @"window": windowID ?: @0,
      @"gesture": @(state.gestureID), @"q": @(touch ? nativeTouch : 0), @"code": @(code ? code : state && !owned ? 7 : owned && !metrics ? 8 : 0),
      @"u0": @(u0), @"u1": @(u1), @"w": @(wall), @"willDecelerate": @(decelerate), @"metrics": metrics ?: NSNull.null, @"touch": point ?: NSNull.null} mutableCopy]);
  } @catch (__unused NSException *e) {}
}

static HSSState *HSSAdmit(UIScrollView *scroll) {
  @try {
    if (!scroll || !NSThread.isMainThread || HSSSequence >= 2048 || HSSNextCall >= 2048) return nil;
    id receiver = scroll.superview; HSSState *state = HSSGet(receiver);
    if (state) return HSSOwned(receiver, scroll) && state.scroll == scroll ? state : nil;
    if (!HSSOwned(receiver, scroll) || HSSNextInstance >= 8) return nil;
    int code = HSSAdoptOwnedPair((id<HSSPairContract>)receiver, (id<HSSPairContract>)scroll, HSSBase, HSSObserved, HSSScrollClass);
    if (code != 0) { HSSObserve(13, 3, 0, nil, nil, nil, 0, -1, code); return nil; }
    state = [HSSState new]; state.instanceID = ++HSSNextInstance; state.scroll = scroll;
    objc_setAssociatedObject(receiver, &HSSStateKey, state, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    HSSObserve(1, 3, 0, receiver, state, nil, 0, -1, 0); return state;
  } @catch (__unused NSException *e) { return nil; }
}

void HSSOriginalTouch(UITouch *touch, NSUInteger nativeTouch, NSInteger kind) {
  @try {
    if (!touch || kind < 1 || kind > 4 || !NSThread.isMainThread || HSSSequence > 2048) return;
    UIView *view = touch.view;
    for (NSUInteger depth = 0; view && depth < 24; depth++, view = view.superview) {
      if (object_getClass(view) != HSSScrollClass) continue;
      UIScrollView *scroll = (UIScrollView *)view; HSSState *state = HSSAdmit(scroll);
      if (state) HSSObserve(kind + 1, 3, 0, scroll.superview, state, touch, nativeTouch, -1, 0);
      return;
    }
  } @catch (__unused NSException *e) {}
}
void HSSOriginalScrollPermission(UIScrollView *scroll) { @try { HSSAdmit(scroll); } @catch (__unused NSException *e) {} }

static void HSSCallback(NSInteger kind, NSInteger phase, NSUInteger call, id receiver, UIScrollView *scroll, NSInteger decelerate) {
  if (call == 0) return;
  HSSState *state = HSSGet(receiver);
  if (state && state.scroll == scroll) {
    if (kind == 7 && phase == 0 && state.gestureID < 2048) state.gestureID++;
    HSSObserve(kind, phase, call, receiver, state, nil, 0, decelerate, 0);
  }
}
static NSUInteger HSSCallID(void) {
  @try { return NSThread.isMainThread && HSSNextCall < 2048 ? ++HSSNextCall : 0; }
  @catch (__unused NSException *e) { return 0; }
}
static void HSSCall(IMP original, NSInteger kind, id receiver, SEL selector, UIScrollView *scroll) {
  NSUInteger call = HSSCallID();
  HSSForwardObject(original, receiver, selector, scroll, ^(int phase) { HSSCallback(kind, phase, call, receiver, scroll, -1); });
}
static void DidScroll(id self, SEL cmd, UIScrollView *scroll) { HSSCall(HSSDidScroll, 6, self, cmd, scroll); }
static void BeginDrag(id self, SEL cmd, UIScrollView *scroll) { HSSCall(HSSBeginDrag, 7, self, cmd, scroll); }
static void EndDrag(id self, SEL cmd, UIScrollView *scroll, BOOL decelerate) {
  NSUInteger call = HSSCallID();
  HSSForwardBool(HSSEndDrag, self, cmd, scroll, decelerate, ^(int phase) { HSSCallback(8, phase, call, self, scroll, decelerate ? 1 : 0); });
}
static void BeginDecel(id self, SEL cmd, UIScrollView *scroll) { HSSCall(HSSBeginDecel, 9, self, cmd, scroll); }
static void EndDecel(id self, SEL cmd, UIScrollView *scroll) { HSSCall(HSSEndDecel, 10, self, cmd, scroll); }
static void EndAnimation(id self, SEL cmd, UIScrollView *scroll) { HSSCall(HSSEndAnimation, 11, self, cmd, scroll); }
static void MoveWindow(id self, SEL cmd) {
  NSUInteger call = HSSCallID(); HSSState *state = HSSGet(self); UIScrollView *scroll = state.scroll;
  HSSForwardVoid(HSSMoveWindow, self, cmd, ^(int phase) { HSSCallback(12, phase, call, self, scroll, -1); });
}

@interface HSSLoader : NSObject @end
@implementation HSSLoader
+ (void)load {
  @autoreleasepool {
    HSSEpoch = llround(CACurrentMediaTime() * 1000000); HSSWindows = [NSMapTable weakToStrongObjectsMapTable];
    HSSBase = NSClassFromString(@"RCTScrollViewComponentView"); HSSScrollClass = NSClassFromString(@"RCTEnhancedScrollView");
    HSCNativeHook hooks[] = {
      {HSSBase, @selector(scrollViewDidScroll:), 3, 'v', (IMP)DidScroll, &HSSDidScroll, "@"},
      {HSSBase, @selector(scrollViewWillBeginDragging:), 3, 'v', (IMP)BeginDrag, &HSSBeginDrag, "@"},
      {HSSBase, @selector(scrollViewDidEndDragging:willDecelerate:), 4, 'v', (IMP)EndDrag, &HSSEndDrag, "@b"},
      {HSSBase, @selector(scrollViewWillBeginDecelerating:), 3, 'v', (IMP)BeginDecel, &HSSBeginDecel, "@"},
      {HSSBase, @selector(scrollViewDidEndDecelerating:), 3, 'v', (IMP)EndDecel, &HSSEndDecel, "@"},
      {HSSBase, @selector(scrollViewDidEndScrollingAnimation:), 3, 'v', (IMP)EndAnimation, &HSSEndAnimation, "@"},
      {HSSBase, @selector(didMoveToWindow), 2, 'v', (IMP)MoveWindow, &HSSMoveWindow, ""}
    };
    int code = 1;
    if ([HSSBase isSubclassOfClass:UIView.class] && [HSSScrollClass isSubclassOfClass:UIScrollView.class] &&
      HSSObjectGetter(HSSBase, @selector(scrollView)) && HSSObjectGetter(HSSScrollClass, @selector(overridingDelegate)))
      HSSObserved = HSSPrepareReceiver(HSSBase, "HSSObservedHelpScrollReceiver", hooks, 7, &code);
    HSSObserve(0, 3, 0, nil, nil, nil, 0, -1, code);
  }
}
@end
