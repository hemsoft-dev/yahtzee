// Linked only into the generated qualification simulator target, never archives.
#import <UIKit/UIKit.h>
#import <QuartzCore/QuartzCore.h>
#import <TargetConditionals.h>
#import <fcntl.h>
#import <unistd.h>
#include <math.h>
#import "RuntimeHooks.h"
#if !TARGET_OS_SIMULATOR
#error NativeCancelObserver is restricted to qualification simulators.
#endif

// Kind: install0/start1/move2/end3/UIKitCancel4/reset5/RNCancel6/
// simultaneousEnter7/simultaneousExit8/scrollDecision9/detach10/budget11.
// Origin: unknown0/UIKitEntry1/resetEntry2/externalRecognizer3/detach4.
@interface HSCNativeState : NSObject
@property (strong) NSMapTable<UITouch *, NSNumber *> *touches;
@property (strong) NSMapTable<UITouch *, NSNumber *> *moves;
@property (weak) UIGestureRecognizer *peer;
@property NSInteger origin;
@property NSUInteger contextID;
@end
@implementation HSCNativeState
- (instancetype)init { if ((self = [super init])) { _touches = [NSMapTable weakToStrongObjectsMapTable]; _moves = [NSMapTable weakToStrongObjectsMapTable]; } return self; }
@end

static char HSCStateKey;
static NSUInteger HSCSequence, HSCNextTouch, HSCNextContext;
static IMP HSCBegan, HSCMoved, HSCEnded, HSCCancelled, HSCReset, HSCCancel, HSCSimultaneous, HSCDetach, HSCScroll;

static HSCNativeState *HSCState(id object) {
  @try {
    HSCNativeState *state = objc_getAssociatedObject(object, &HSCStateKey);
    if (!state) { state = [HSCNativeState new]; objc_setAssociatedObject(object, &HSCStateKey, state, OBJC_ASSOCIATION_RETAIN_NONATOMIC); }
    return state;
  } @catch (__unused NSException *error) { return nil; }
}
static NSNumber *HSCMilli(double value) { return isfinite(value) && fabs(value) <= 1000000 ? @(llround(value * 1000)) : nil; }
static NSInteger HSCTarget(UIView *view, UIView **matched) {
  NSArray *ids = @[@"score-ones", @"score-twos", @"score-threes", @"score-fours", @"score-fives", @"score-sixes"];
  for (NSUInteger depth = 0; view && depth < 24; depth++, view = view.superview) {
    NSUInteger index = [ids indexOfObject:view.accessibilityIdentifier ?: @""];
    if (index != NSNotFound) { if (matched) *matched = view; return index + 1; }
  }
  return 0;
}
static NSDictionary *HSCPeer(UIGestureRecognizer *peer, UIView *root) {
  if (!peer) return @{};
  NSInteger kind = [peer isKindOfClass:UIPanGestureRecognizer.class] ? 1 : [peer isKindOfClass:UITapGestureRecognizer.class] ? 2 :
    [peer isKindOfClass:UILongPressGestureRecognizer.class] ? 3 : [peer isKindOfClass:NSClassFromString(@"RCTSurfaceTouchHandler")] ? 4 :
    [peer isKindOfClass:NSClassFromString(@"RCTSurfacePointerHandler")] ? 5 : [peer isKindOfClass:UISwipeGestureRecognizer.class] ? 6 :
    [peer isKindOfClass:UIPinchGestureRecognizer.class] ? 7 : [peer isKindOfClass:UIRotationGestureRecognizer.class] ? 8 : 0;
  UIView *view = peer.view;
  NSInteger relation = !view || !root ? 0 : view == root ? 1 : [view isDescendantOfView:root] ? 2 : [root isDescendantOfView:view] ? 3 : 4;
  BOOL scrollPan = [view isKindOfClass:UIScrollView.class] && ((UIScrollView *)view).panGestureRecognizer == peer;
  return @{@"kind": @(kind), @"state": @(peer.state), @"cancels": @(peer.cancelsTouchesInView), @"relation": @(relation), @"scrollPan": @(scrollPan)};
}

// Main-thread snapshots are bounded numbers. Serialization and writes are async;
// no messages, class names, identifiers, object addresses or error text are kept.
static void HSCWrite(NSMutableDictionary *record) {
  if (HSCSequence > 2048) return;
  if (HSCSequence == 2048) record = [@{@"k": @11, @"origin": @0, @"q": @0, @"target": @0} mutableCopy];
  record[@"s"] = @1; record[@"seq"] = @(HSCSequence++); record[@"pid"] = @(getpid());
  static dispatch_queue_t queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ queue = dispatch_queue_create("dev.hemsoft.native-cancel-write", DISPATCH_QUEUE_SERIAL); });
  NSDictionary *snapshot = [record copy];
  dispatch_async(queue, ^{
    @try {
      static NSFileHandle *handle;
      static BOOL attempted;
      if (!attempted) {
        attempted = YES;
        NSString *dir = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
        NSString *path = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@"native-cancel-%d.jsonl", getpid()]];
        int fd = path ? open(path.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600) : -1;
        if (fd >= 0) handle = [[NSFileHandle alloc] initWithFileDescriptor:fd closeOnDealloc:YES];
      }
      NSData *data = [NSJSONSerialization dataWithJSONObject:snapshot options:0 error:nil];
      if (handle && data.length <= 8192) { [handle writeData:data]; [handle writeData:[NSData dataWithBytes:"\n" length:1]]; }
    } @catch (__unused NSException *error) { /* Observation cannot change touch dispatch. */ }
  });
}

static void HSCObserve(NSInteger kind, id owner, UITouch *touch, UIView *view, NSInteger result) {
  @try {
    if (!NSThread.isMainThread || HSCSequence > 2048) return;
    double u0 = CACurrentMediaTime(), wall = NSDate.date.timeIntervalSince1970, u1 = CACurrentMediaTime();
    HSCNativeState *state = HSCState(owner);
    UIView *root = [owner isKindOfClass:UIGestureRecognizer.class] ? ((UIGestureRecognizer *)owner).view : nil;
    UIView *targetView = nil; NSInteger target = HSCTarget(touch ? touch.view : view, &targetView);
    NSMutableDictionary *row = [@{@"k": @(kind), @"origin": @(state.origin), @"cx": @(state.contextID), @"q": touch ? ([state.touches objectForKey:touch] ?: @0) : @0,
      @"target": @(target), @"u0": @(u0), @"w": @(wall), @"u1": @(u1), @"result": @(result), @"peer": HSCPeer(state.peer, root)} mutableCopy];
    if (kind == 9 && [owner isKindOfClass:UIScrollView.class]) row[@"peer"] = HSCPeer(((UIScrollView *)owner).panGestureRecognizer, owner);
    if (touch) {
      UIWindow *window = touch.window;
      CGPoint point = [touch locationInView:window], previous = [touch previousLocationInView:window];
      CGRect frame = targetView && window ? [targetView convertRect:targetView.bounds toView:window] : CGRectNull;
      row[@"tt"] = @(touch.timestamp); row[@"phase"] = @(touch.phase);
      row[@"movesTruncated"] = @([[state.moves objectForKey:touch] unsignedIntegerValue] > 8);
      row[@"x"] = HSCMilli(point.x) ?: NSNull.null; row[@"y"] = HSCMilli(point.y) ?: NSNull.null;
      row[@"px"] = HSCMilli(previous.x) ?: NSNull.null; row[@"py"] = HSCMilli(previous.y) ?: NSNull.null;
      if (window) {
        row[@"ww"] = HSCMilli(window.bounds.size.width) ?: NSNull.null; row[@"wh"] = HSCMilli(window.bounds.size.height) ?: NSNull.null;
        row[@"scale"] = HSCMilli(window.screen.scale) ?: NSNull.null; row[@"orientation"] = @(window.windowScene.interfaceOrientation);
        CGPoint screen = [window convertPoint:point toCoordinateSpace:window.screen.coordinateSpace];
        row[@"sx"] = HSCMilli(screen.x) ?: NSNull.null; row[@"sy"] = HSCMilli(screen.y) ?: NSNull.null;
      }
      if (!CGRectIsNull(frame)) {
        row[@"fx"] = HSCMilli(frame.origin.x) ?: NSNull.null; row[@"fy"] = HSCMilli(frame.origin.y) ?: NSNull.null;
        row[@"fw"] = HSCMilli(frame.size.width) ?: NSNull.null; row[@"fh"] = HSCMilli(frame.size.height) ?: NSNull.null;
      }
      NSArray *recognizers = touch.gestureRecognizers ?: @[];
      NSMutableArray *candidates = [NSMutableArray new];
      for (UIGestureRecognizer *candidate in recognizers) { if (candidates.count == 8) break; [candidates addObject:HSCPeer(candidate, root)]; }
      row[@"candidates"] = candidates; row[@"candidatesTruncated"] = @(recognizers.count > 8);
    }
    HSCWrite(row);
  } @catch (__unused NSException *error) { /* Preserve the original call even if observation fails. */ }
}
static void HSCObserveActive(NSInteger kind, id owner) {
  @try {
    HSCNativeState *state = HSCState(owner);
    NSArray *touches = state.touches.keyEnumerator.allObjects;
    if (touches.count == 0) HSCObserve(kind, owner, nil, nil, -1);
    for (UITouch *touch in [touches subarrayWithRange:NSMakeRange(0, MIN(touches.count, 16))]) HSCObserve(kind, owner, touch, nil, -1);
  } @catch (__unused NSException *error) {}
}
static void HSCPrepare(id owner, NSSet<UITouch *> *touches, NSInteger kind) {
  @try {
    HSCNativeState *state = HSCState(owner); NSUInteger n = 0;
    for (UITouch *touch in touches) {
      if (n++ == 16) break;
      if (kind == 1 && state.touches.count < 16 && HSCNextTouch < 2048) [state.touches setObject:@(++HSCNextTouch) forKey:touch];
      if (kind == 2) {
        NSUInteger moves = [[state.moves objectForKey:touch] unsignedIntegerValue];
        [state.moves setObject:@(moves + 1) forKey:touch];
        if (moves >= 8) continue; // Cancellation/end still records its fresh position.
      }
      HSCObserve(kind, owner, touch, nil, -1);
    }
  } @catch (__unused NSException *error) {}
}
static void HSCClose(id owner, NSSet<UITouch *> *touches) {
  @try { HSCNativeState *s = HSCState(owner); for (UITouch *t in touches) { [s.touches removeObjectForKey:t]; [s.moves removeObjectForKey:t]; } } @catch (__unused NSException *error) {}
}

static void Began(id self, SEL cmd, NSSet *touches, UIEvent *event) { HSCPrepare(self, touches, 1); ((void (*)(id, SEL, id, id))HSCBegan)(self, cmd, touches, event); }
static void Moved(id self, SEL cmd, NSSet *touches, UIEvent *event) { HSCPrepare(self, touches, 2); ((void (*)(id, SEL, id, id))HSCMoved)(self, cmd, touches, event); }
static void Ended(id self, SEL cmd, NSSet *touches, UIEvent *event) { HSCPrepare(self, touches, 3); ((void (*)(id, SEL, id, id))HSCEnded)(self, cmd, touches, event); HSCClose(self, touches); }
static void Cancelled(id self, SEL cmd, NSSet *touches, UIEvent *event) {
  HSCNativeState *s = HSCState(self); NSInteger prior = s.origin; if (prior == 0) s.origin = 1;
  @try { HSCPrepare(self, touches, 4); ((void (*)(id, SEL, id, id))HSCCancelled)(self, cmd, touches, event); }
  @finally { s.origin = prior; HSCClose(self, touches); }
}
static void Reset(id self, SEL cmd) {
  HSCNativeState *s = HSCState(self); NSInteger prior = s.origin; if (s.origin == 0) s.origin = 2;
  @try { HSCObserveActive(5, self); ((void (*)(id, SEL))HSCReset)(self, cmd); }
  @finally { @try { [s.touches removeAllObjects]; [s.moves removeAllObjects]; } @catch (__unused NSException *error) {} s.origin = prior; }
}
static void Cancel(id self, SEL cmd) { HSCObserveActive(6, self); ((void (*)(id, SEL))HSCCancel)(self, cmd); }
static BOOL Simultaneous(id self, SEL cmd, UIGestureRecognizer *recognizer, UIGestureRecognizer *other) {
  HSCNativeState *s = HSCState(self); UIGestureRecognizer *priorPeer = s.peer; NSInteger prior = s.origin; NSUInteger priorContext = s.contextID;
  s.peer = other; s.origin = 3; s.contextID = ++HSCNextContext;
  @try {
    HSCObserveActive(7, self);
    BOOL result = ((BOOL (*)(id, SEL, id, id))HSCSimultaneous)(self, cmd, recognizer, other);
    HSCObserve(8, self, nil, nil, result ? 1 : 0); return result;
  } @finally { s.peer = priorPeer; s.origin = prior; s.contextID = priorContext; }
}
static void Detach(id self, SEL cmd, UIView *view) {
  HSCNativeState *s = HSCState(self); NSInteger prior = s.origin; NSUInteger priorContext = s.contextID; s.origin = 4; s.contextID = ++HSCNextContext;
  @try { HSCObserveActive(10, self); ((void (*)(id, SEL, id))HSCDetach)(self, cmd, view); }
  @finally { s.origin = prior; s.contextID = priorContext; }
}
static BOOL Scroll(id self, SEL cmd, UIView *view) {
  BOOL result = ((BOOL (*)(id, SEL, id))HSCScroll)(self, cmd, view);
  HSCObserve(9, self, nil, view, result ? 1 : 0); return result;
}

@interface HSCNativeCancelLoader : NSObject @end
@implementation HSCNativeCancelLoader
+ (void)load {
  @autoreleasepool {
    Class surface = NSClassFromString(@"RCTSurfaceTouchHandler"), scroll = NSClassFromString(@"RCTEnhancedScrollView");
    HSCNativeHook hooks[] = {
      {surface, @selector(touchesBegan:withEvent:), 4, 'v', (IMP)Began, &HSCBegan},
      {surface, @selector(touchesMoved:withEvent:), 4, 'v', (IMP)Moved, &HSCMoved},
      {surface, @selector(touchesEnded:withEvent:), 4, 'v', (IMP)Ended, &HSCEnded},
      {surface, @selector(touchesCancelled:withEvent:), 4, 'v', (IMP)Cancelled, &HSCCancelled},
      {surface, @selector(reset), 2, 'v', (IMP)Reset, &HSCReset},
      {surface, NSSelectorFromString(@"_cancelTouches"), 2, 'v', (IMP)Cancel, &HSCCancel},
      {surface, @selector(gestureRecognizer:shouldRecognizeSimultaneouslyWithGestureRecognizer:), 4, 'b', (IMP)Simultaneous, &HSCSimultaneous},
      {surface, NSSelectorFromString(@"detachFromView:"), 3, 'v', (IMP)Detach, &HSCDetach},
      {scroll, @selector(touchesShouldCancelInContentView:), 3, 'b', (IMP)Scroll, &HSCScroll}
    };
    int code = HSCInstallNativeHooks(hooks, sizeof(hooks) / sizeof(hooks[0]));
    double u0 = CACurrentMediaTime(), wall = NSDate.date.timeIntervalSince1970, u1 = CACurrentMediaTime();
    HSCWrite([@{@"k": @0, @"origin": @0, @"q": @0, @"target": @0, @"installCode": @(code), @"hookCount": @(code == 0 ? 9 : 0), @"u0": @(u0), @"w": @(wall), @"u1": @(u1)} mutableCopy]);
  }
}
@end
