#import "RuntimeHooks.h"
#include <assert.h>

@interface HSCControl : NSObject
@property int calls;
@property (strong) id first;
@property (strong) id second;
- (void)receive:(id)a event:(id)b;
- (BOOL)decide:(id)a other:(id)b;
- (void)reset;
@end
@implementation HSCControl
- (void)receive:(id)a event:(id)b { self.calls++; self.first = a; self.second = b; if ([a isKindOfClass:NSException.class]) @throw a; }
- (BOOL)decide:(id)a other:(id)b { self.calls++; self.first = a; self.second = b; return a == b; }
- (void)reset { self.calls++; }
@end
@interface HSCInherited : HSCControl @end
@implementation HSCInherited @end

static IMP receiveOriginal, decideOriginal, resetOriginal;
static void Receive(id self, SEL cmd, id a, id b) { ((void (*)(id, SEL, id, id))receiveOriginal)(self, cmd, a, b); }
static BOOL Decide(id self, SEL cmd, id a, id b) { return ((BOOL (*)(id, SEL, id, id))decideOriginal)(self, cmd, a, b); }
static void Reset(id self, SEL cmd) { ((void (*)(id, SEL))resetOriginal)(self, cmd); }

int main(void) {
  @autoreleasepool {
    HSCNativeHook hooks[] = {
      {HSCControl.class, @selector(receive:event:), 4, 'v', (IMP)Receive, &receiveOriginal},
      {HSCControl.class, @selector(decide:other:), 4, 'b', (IMP)Decide, &decideOriginal},
      {HSCControl.class, @selector(reset), 2, 'v', (IMP)Reset, &resetOriginal}
    };
    IMP before = class_getMethodImplementation(HSCControl.class, @selector(receive:event:));
    hooks[1].arguments = 3;
    assert(HSCInstallNativeHooks(hooks, 3) != 0);
    assert(class_getMethodImplementation(HSCControl.class, @selector(receive:event:)) == before);
    assert(receiveOriginal == NULL);
    hooks[1].arguments = 4;
    hooks[2].cls = HSCInherited.class;
    assert(HSCInstallNativeHooks(hooks, 3) != 0); // Do not replace a superclass implementation.
    assert(class_getMethodImplementation(HSCControl.class, @selector(receive:event:)) == before);
    hooks[2].cls = HSCControl.class;
    assert(HSCInstallNativeHooks(hooks, 3) == 0);
    HSCControl *c = [HSCControl new]; id a = [NSObject new], b = [NSObject new];
    [c receive:a event:b]; assert(c.calls == 1 && c.first == a && c.second == b);
    assert([c decide:a other:a] == YES && c.calls == 2);
    assert([c decide:a other:b] == NO && c.calls == 3 && c.second == b);
    [c reset]; assert(c.calls == 4);
    NSException *e = [NSException exceptionWithName:@"control" reason:nil userInfo:nil];
    BOOL caught = NO;
    @try { [c receive:e event:a]; } @catch (NSException *actual) { caught = actual == e; }
    assert(caught && c.calls == 5);
    assert(HSCInstallNativeHooks(hooks, 3) != 0); // Cannot install twice and recurse.
    assert(HSCInstallNativeHooks(hooks, 0) != 0);
    puts("native-cancel-forwarding-control:pass");
  }
  return 0;
}
