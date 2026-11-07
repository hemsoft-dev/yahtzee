// Only the generated qualification simulator target links this observer.
#import <UIKit/UIKit.h>
#import <QuartzCore/QuartzCore.h>
#import <TargetConditionals.h>
#import <fcntl.h>
#import <unistd.h>
#include <math.h>
#import "ModalWindowRuntime.h"
#if !TARGET_OS_SIMULATOR
#error NativeModalObserver is restricted to qualification simulators.
#endif

// Kinds: install0/show1/show-return2/show-throw3/window4/unavailable5/
// dispatch6/dispatch-return7/dispatch-throw8/hide9/hide-return10/hide-throw11/budget12.
@interface HSMState : NSObject
@property(nonatomic) NSUInteger alertID;
@property(nonatomic) NSUInteger windowID;
@property(nonatomic) NSUInteger nextTouch;
@property(nonatomic, weak) UIWindow *window;
@property(nonatomic, weak) UIAlertController *controller;
@property(nonatomic, strong) NSMapTable<UITouch *, NSNumber *> *touches;
@end
@implementation HSMState
- (instancetype)init { if ((self = [super init])) _touches = [NSMapTable weakToStrongObjectsMapTable]; return self; }
@end
static char HSMStateKey;
static NSUInteger HSMSequence, HSMNextAlert, HSMNextWindow, HSMNextDispatch;
static IMP HSMWindowOriginal, HSMShowOriginal, HSMHideOriginal;
static long long HSMEpoch; // Module-load monotonic microseconds, scoped by pid and source/run receipt.

static NSNumber *HSMMilli(double n) { return isfinite(n) && fabs(n) <= 1000000 ? @(llround(n * 1000)) : nil; }
static HSMState *HSMGet(id object) { @try { return objc_getAssociatedObject(object, &HSMStateKey); } @catch (__unused NSException *error) { return nil; } }
static void HSMWrite(NSMutableDictionary *row) {
  @try {
    if (HSMSequence > 2048) return;
    if (HSMSequence == 2048) row = [@{@"k": @12, @"a": @0, @"win": @0, @"d": @0, @"q": @0, @"target": @0} mutableCopy];
    row[@"s"] = @1; row[@"seq"] = @(HSMSequence++); row[@"pid"] = @(getpid()); row[@"epoch"] = @(HSMEpoch);
    static dispatch_queue_t queue; static dispatch_once_t once;
    dispatch_once(&once, ^{ queue = dispatch_queue_create("dev.hemsoft.native-modal-write", DISPATCH_QUEUE_SERIAL); });
    NSDictionary *snapshot = [row copy];
    dispatch_async(queue, ^{
      @try {
        static BOOL attempted; static NSFileHandle *handle;
        if (!attempted) {
          attempted = YES;
          NSString *dir = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
          NSString *path = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@"native-modal-%d-%lld.jsonl", getpid(), HSMEpoch]];
          int fd = path ? open(path.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600) : -1;
          if (fd >= 0) handle = [[NSFileHandle alloc] initWithFileDescriptor:fd closeOnDealloc:YES];
        }
        NSData *data = [NSJSONSerialization dataWithJSONObject:snapshot options:0 error:nil];
        if (handle && data.length <= 8192) { [handle writeData:data]; [handle writeData:[NSData dataWithBytes:"\n" length:1]]; }
      } @catch (__unused NSException *error) {}
    });
  } @catch (__unused NSException *error) {}
}
static BOOL HSMKnown(UIAlertController *controller) {
  @try {
    if (!NSThread.isMainThread || object_getClass(controller) != NSClassFromString(@"RCTAlertController")) return NO;
    if (![controller.title isEqualToString:@"Delete all local data"] || controller.textFields.count != 0 || controller.actions.count != 2) return NO;
    NSUInteger cancel = 0, accept = 0;
    for (UIAlertAction *action in controller.actions) {
      if ([action.title isEqualToString:@"Cancel"] && action.style == UIAlertActionStyleCancel) cancel++;
      if ([action.title isEqualToString:@"Delete all local data"] && action.style == UIAlertActionStyleDestructive) accept++;
    }
    return cancel == 1 && accept == 1;
  } @catch (__unused NSException *error) { return NO; }
}
static HSMState *HSMController(UIAlertController *controller) {
  @try {
    HSMState *state = HSMGet(controller);
    if (state || !HSMKnown(controller) || HSMNextAlert >= 128) return state;
    state = [HSMState new]; state.alertID = ++HSMNextAlert; state.controller = controller;
    objc_setAssociatedObject(controller, &HSMStateKey, state, OBJC_ASSOCIATION_RETAIN_NONATOMIC); return state;
  } @catch (__unused NSException *error) { return nil; }
}
static NSDictionary *HSMCandidate(UIGestureRecognizer *g, UIWindow *window) {
  NSInteger kind = [g isKindOfClass:UIPanGestureRecognizer.class] ? 1 : [g isKindOfClass:UITapGestureRecognizer.class] ? 2 :
    [g isKindOfClass:UILongPressGestureRecognizer.class] ? 3 : [g isKindOfClass:UIPinchGestureRecognizer.class] ? 4 :
    [g isKindOfClass:UISwipeGestureRecognizer.class] ? 5 : [g isKindOfClass:UIRotationGestureRecognizer.class] ? 6 : 0;
  NSInteger relation = g.view == window ? 1 : [g.view isDescendantOfView:window] ? 2 : 0;
  return @{@"kind": @(kind), @"state": @(g.state), @"relation": @(relation), @"cancels": @(g.cancelsTouchesInView)};
}
static NSInteger HSMTarget(UIView *view, UIView **matched) {
  for (NSUInteger depth = 0; view && depth < 24; depth++, view = view.superview) {
    BOOL button = [view isKindOfClass:UIControl.class] || (view.accessibilityTraits & UIAccessibilityTraitButton) != 0;
    if (!button) continue;
    NSInteger target = [view.accessibilityLabel isEqualToString:@"Delete all local data"] ? 1 : [view.accessibilityLabel isEqualToString:@"Cancel"] ? 2 : 0;
    if (target) { *matched = view; return target; }
  }
  return 0;
}
static void HSMObserve(NSInteger kind, HSMState *state, NSUInteger dispatchID, UITouch *touch, NSInteger code, BOOL supplied) {
  @try {
    if (!NSThread.isMainThread || !state) return;
    double u0 = CACurrentMediaTime(), wall = NSDate.date.timeIntervalSince1970, u1 = CACurrentMediaTime();
    UIWindow *window = state.window; UIAlertController *controller = state.controller;
    NSMutableDictionary *row = [@{@"k": @(kind), @"a": @(state.alertID), @"win": @(state.windowID), @"d": @(dispatchID),
      @"q": touch ? ([state.touches objectForKey:touch] ?: @0) : @0, @"target": @0, @"code": @(code),
      @"completionSupplied": @(supplied), @"u0": @(u0), @"w": @(wall), @"u1": @(u1), @"callbackDirect": @NO} mutableCopy];
    if (window) {
      row[@"hidden"] = @(window.hidden); row[@"scene"] = @(window.windowScene != nil);
      row[@"presented"] = @(controller && window.rootViewController.presentedViewController == controller);
      row[@"ww"] = HSMMilli(window.bounds.size.width) ?: NSNull.null; row[@"wh"] = HSMMilli(window.bounds.size.height) ?: NSNull.null;
      row[@"scale"] = HSMMilli(window.screen.scale) ?: NSNull.null; row[@"orientation"] = @(window.windowScene.interfaceOrientation);
    }
    if (touch) {
      UIView *matched = nil; NSInteger target = HSMTarget(touch.view, &matched);
      CGPoint point = [touch locationInView:window], previous = [touch previousLocationInView:window];
      row[@"target"] = @(target); row[@"tt"] = @(touch.timestamp); row[@"phase"] = @(touch.phase);
      row[@"x"] = HSMMilli(point.x) ?: NSNull.null; row[@"y"] = HSMMilli(point.y) ?: NSNull.null;
      row[@"px"] = HSMMilli(previous.x) ?: NSNull.null; row[@"py"] = HSMMilli(previous.y) ?: NSNull.null;
      if (window) {
        CGPoint screen = [window convertPoint:point toCoordinateSpace:window.screen.coordinateSpace];
        row[@"sx"] = HSMMilli(screen.x) ?: NSNull.null; row[@"sy"] = HSMMilli(screen.y) ?: NSNull.null;
      }
      if (matched && window) {
        CGRect frame = [matched convertRect:matched.bounds toView:window];
        row[@"fx"] = HSMMilli(frame.origin.x) ?: NSNull.null; row[@"fy"] = HSMMilli(frame.origin.y) ?: NSNull.null;
        row[@"fw"] = HSMMilli(frame.size.width) ?: NSNull.null; row[@"fh"] = HSMMilli(frame.size.height) ?: NSNull.null;
      }
      NSArray *recognizers = touch.gestureRecognizers ?: @[]; NSMutableArray *candidates = [NSMutableArray new];
      for (UIGestureRecognizer *g in recognizers) { if (candidates.count == 8) break; [candidates addObject:HSMCandidate(g, window)]; }
      row[@"candidates"] = candidates; row[@"candidatesTruncated"] = @(recognizers.count > 8);
    }
    HSMWrite(row);
  } @catch (__unused NSException *error) {}
}

@interface HSMOwnedAlertWindow : UIWindow @end
@implementation HSMOwnedAlertWindow
- (void)sendEvent:(UIEvent *)event {
  HSMState *state = HSMGet(self); NSUInteger dispatchID = 0;
  @try {
    if (state && NSThread.isMainThread && event.type == UIEventTypeTouches && HSMSequence <= 2048) {
      dispatchID = ++HSMNextDispatch; NSUInteger count = 0;
      for (UITouch *touch in event.allTouches) {
        if (touch.window != self) continue;
        if (count++ == 4) break;
        if (touch.phase == UITouchPhaseBegan && state.touches.count < 16 && state.nextTouch < 128)
          [state.touches setObject:@(++state.nextTouch) forKey:touch];
        HSMObserve(6, state, dispatchID, touch, 0, NO);
      }
    }
  } @catch (__unused NSException *error) {}
  BOOL returned = NO;
  @try { [super sendEvent:event]; returned = YES; }
  @finally {
    @try {
      if (dispatchID) {
        HSMObserve(returned ? 7 : 8, state, dispatchID, nil, 0, NO);
        for (UITouch *touch in event.allTouches)
          if (touch.window == self && (touch.phase == UITouchPhaseEnded || touch.phase == UITouchPhaseCancelled)) [state.touches removeObjectForKey:touch];
      }
    } @catch (__unused NSException *error) {}
  }
}
@end

static id ModalWindow(id self, SEL cmd) {
  UIWindow *window = ((id (*)(id, SEL))HSMWindowOriginal)(self, cmd);
  @try {
    HSMState *controllerState = HSMController(self);
    if (controllerState && window) {
      HSMState *state = HSMGet(window);
      if (!state && HSMNextWindow < 128) {
        state = [HSMState new]; state.alertID = controllerState.alertID; state.windowID = ++HSMNextWindow;
        state.window = window; state.controller = self;
        NSInteger code = object_getClass(window.rootViewController) == UIViewController.class
          ? HSCAdoptOwnedModalObject(window, UIWindow.class, HSMOwnedAlertWindow.class) : 7;
        objc_setAssociatedObject(window, &HSMStateKey, state, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        objc_setAssociatedObject(self, &HSMStateKey, state, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        HSMObserve(code == 0 ? 4 : 5, state, 0, nil, code, NO);
      } else if (state) HSMObserve(4, state, 0, nil, object_getClass(window) == HSMOwnedAlertWindow.class ? 0 : 8, NO);
    }
  } @catch (__unused NSException *error) {}
  return window;
}
static void ModalShow(id self, SEL cmd, BOOL animated, id completion) {
  HSMState *state = HSMController(self); HSMObserve(1, state, 0, nil, animated ? 1 : 0, completion != nil);
  BOOL returned = NO;
  @try { ((void (*)(id, SEL, BOOL, id))HSMShowOriginal)(self, cmd, animated, completion); returned = YES; }
  @finally { HSMObserve(returned ? 2 : 3, HSMGet(self) ?: state, 0, nil, animated ? 1 : 0, completion != nil); }
}
static void ModalHide(id self, SEL cmd) {
  HSMState *state = HSMGet(self); HSMObserve(9, state, 0, nil, 0, NO); BOOL returned = NO;
  @try { ((void (*)(id, SEL))HSMHideOriginal)(self, cmd); returned = YES; }
  @finally { HSMObserve(returned ? 10 : 11, state, 0, nil, 0, NO); }
}
@interface HSMOwnedModalLoader : NSObject @end
@implementation HSMOwnedModalLoader
+ (void)load {
  @autoreleasepool {
    HSMEpoch = llround(CACurrentMediaTime() * 1000000);
    Class controller = NSClassFromString(@"RCTAlertController");
    HSCNativeHook hooks[] = {
      {controller, NSSelectorFromString(@"alertWindow"), 2, '@', (IMP)ModalWindow, &HSMWindowOriginal, ""},
      {controller, NSSelectorFromString(@"show:completion:"), 4, 'v', (IMP)ModalShow, &HSMShowOriginal, "b@"},
      {controller, NSSelectorFromString(@"hide"), 2, 'v', (IMP)ModalHide, &HSMHideOriginal, ""}
    };
    int code = HSCInstallNativeHooks(hooks, 3);
    HSMWrite([@{@"k": @0, @"a": @0, @"win": @0, @"d": @0, @"q": @0, @"target": @0, @"code": @(code), @"hookCount": @(code == 0 ? 3 : 0), @"callbackDirect": @NO} mutableCopy]);
  }
}
@end
