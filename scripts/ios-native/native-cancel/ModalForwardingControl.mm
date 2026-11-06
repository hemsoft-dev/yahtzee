#import "ModalWindowRuntime.h"
#include <assert.h>

@interface HSCModalControlWindow : NSObject
@property int calls;
@property (strong) id argument;
- (void)sendEvent:(id)event;
@end
@implementation HSCModalControlWindow
- (void)sendEvent:(id)event { self.calls++; self.argument = event; if ([event isKindOfClass:NSException.class]) @throw event; }
@end
@interface HSCModalObservedControlWindow : HSCModalControlWindow @end
@implementation HSCModalObservedControlWindow
- (void)sendEvent:(id)event { [super sendEvent:event]; }
@end
@interface HSCModalWrongSize : HSCModalControlWindow { int _extra; } @end
@implementation HSCModalWrongSize @end
@interface HSCModalControllerControl : NSObject
@property int calls;
@property BOOL animated;
@property (strong) id completion;
@property (strong) id window;
@property (strong) NSException *failure;
- (id)ownedWindow;
- (void)show:(BOOL)animated completion:(id)completion;
- (void)hide;
@end
@implementation HSCModalControllerControl
- (id)ownedWindow { self.calls++; if (self.failure) @throw self.failure; return self.window; }
- (void)show:(BOOL)animated completion:(id)completion { self.calls++; self.animated = animated; self.completion = completion; if (self.failure) @throw self.failure; }
- (void)hide { self.calls++; if (self.failure) @throw self.failure; }
@end
static IMP WindowOriginal, ShowOriginal, HideOriginal;
static id Window(id self, SEL cmd) { return ((id (*)(id, SEL))WindowOriginal)(self, cmd); }
static void Show(id self, SEL cmd, BOOL animated, id completion) { ((void (*)(id, SEL, BOOL, id))ShowOriginal)(self, cmd, animated, completion); }
static void Hide(id self, SEL cmd) { ((void (*)(id, SEL))HideOriginal)(self, cmd); }

int main(void) {
  @autoreleasepool {
    HSCModalControlWindow *a = [HSCModalControlWindow new], *unrelated = [HSCModalControlWindow new];
    id event = [NSObject new];
    assert(HSCAdoptOwnedModalObject(a, HSCModalControlWindow.class, HSCModalWrongSize.class) != 0);
    assert(object_getClass(a) == HSCModalControlWindow.class);
    assert(HSCAdoptOwnedModalObject(a, HSCModalControlWindow.class, HSCModalObservedControlWindow.class) == 0);
    assert(object_getClass(unrelated) == HSCModalControlWindow.class);
    [a sendEvent:event]; assert(a.calls == 1 && a.argument == event && unrelated.calls == 0);
    NSException *error = [NSException exceptionWithName:@"modal-control" reason:nil userInfo:nil]; BOOL caught = NO;
    @try { [a sendEvent:error]; } @catch (NSException *actual) { caught = actual == error; }
    assert(caught && a.calls == 2);
    assert(HSCAdoptOwnedModalObject(a, HSCModalControlWindow.class, HSCModalObservedControlWindow.class) != 0);
    HSCNativeHook hooks[] = {
      {HSCModalControllerControl.class, @selector(ownedWindow), 2, '@', (IMP)Window, &WindowOriginal, ""},
      {HSCModalControllerControl.class, @selector(show:completion:), 4, 'v', (IMP)Show, &ShowOriginal, "b@"},
      {HSCModalControllerControl.class, @selector(hide), 2, 'v', (IMP)Hide, &HideOriginal, ""}
    };
    hooks[1].argumentTypes = "@@";
    assert(HSCInstallNativeHooks(hooks, 3) != 0 && WindowOriginal == NULL);
    hooks[1].argumentTypes = "b@";
    assert(HSCInstallNativeHooks(hooks, 3) == 0);
    HSCModalControllerControl *controller = [HSCModalControllerControl new]; controller.window = a;
    assert([controller ownedWindow] == a && controller.calls == 1);
    id completion = ^{};
    [controller show:YES completion:completion]; assert(controller.animated && controller.completion == completion && controller.calls == 2);
    [controller show:NO completion:nil]; assert(!controller.animated && controller.completion == nil && controller.calls == 3);
    [controller hide]; assert(controller.calls == 4);
    controller.window = nil; assert([controller ownedWindow] == nil && controller.calls == 5);
    controller.failure = error; caught = NO;
    @try { [controller ownedWindow]; } @catch (NSException *actual) { caught = actual == error; }
    assert(caught && controller.calls == 6); caught = NO;
    @try { [controller show:YES completion:completion]; } @catch (NSException *actual) { caught = actual == error; }
    assert(caught && controller.calls == 7 && controller.completion == completion && controller.animated); caught = NO;
    @try { [controller hide]; } @catch (NSException *actual) { caught = actual == error; }
    assert(caught && controller.calls == 8);
    puts("native-modal-forwarding-control:pass");
  }
  return 0;
}
