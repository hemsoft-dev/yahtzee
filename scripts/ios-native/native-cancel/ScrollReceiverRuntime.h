#import "RuntimeHooks.h"

@protocol HSSPairContract
- (id)superview;
- (NSString *)accessibilityIdentifier;
- (id)scrollView;
- (id)overridingDelegate;
@end

static BOOL HSSObjectGetter(Class cls, SEL selector) {
  unsigned n = 0; Method *methods = class_copyMethodList(cls, &n); Method found = NULL;
  for (unsigned i = 0; i < n; i++) if (method_getName(methods[i]) == selector) found = methods[i]; free(methods);
  if (!found || method_getNumberOfArguments(found) != 2) return NO;
  char *type = method_copyReturnType(found); BOOL valid = type && strcmp(type, "@") == 0; free(type); return valid;
}

// Same ownership predicate runs with Foundation fixture objects in the control.
static BOOL HSSOwnedPair(id<HSSPairContract> receiver, id<HSSPairContract> scroll, Class base, Class observed, Class scrollClass) {
  @try {
    if (!receiver || !scroll || !base || !observed || !scrollClass) return NO;
    Class actual = object_getClass(receiver);
    if ((actual != base && actual != observed) || object_getClass(scroll) != scrollClass) return NO;
    return [scroll superview] == receiver && [[receiver accessibilityIdentifier] isEqualToString:@"help-viewport"] &&
      [receiver scrollView] == scroll && [scroll overridingDelegate] == receiver;
  } @catch (__unused NSException *e) { return NO; }
}

// Prepare a private subclass without modifying the base class or delegate list.
// Every observed method must be declared by the exact pinned RN receiver class.
static Class HSSPrepareReceiver(Class base, const char *name, HSCNativeHook *hooks, size_t count, int *code) {
  *code = 1;
  if (!base || !name || count == 0 || count > 8 || objc_getClass(name)) return Nil;
  for (size_t i = 0; i < count; i++) {
    HSCNativeHook h = hooks[i]; unsigned n = 0; Method owned = NULL;
    if (h.cls != base || h.result != 'v' || !h.selector || !h.replacement || !h.original || *h.original) return Nil;
    for (size_t j = 0; j < i; j++) if (hooks[j].selector == h.selector) return Nil;
    Method *methods = class_copyMethodList(base, &n);
    for (unsigned j = 0; j < n; j++) if (method_getName(methods[j]) == h.selector) owned = methods[j];
    free(methods);
    if (!owned || method_getNumberOfArguments(owned) != h.arguments || !h.argumentTypes || strlen(h.argumentTypes) != h.arguments - 2) { *code = 2; return Nil; }
    char *ret = method_copyReturnType(owned); BOOL valid = ret && strcmp(ret, "v") == 0; free(ret);
    for (unsigned j = 2; valid && j < h.arguments; j++) {
      char *arg = method_copyArgumentType(owned, j); char expected = h.argumentTypes[j - 2];
      valid = arg && (expected == '@' ? strcmp(arg, "@") == 0 : expected == 'b' && (strcmp(arg, "B") == 0 || strcmp(arg, "c") == 0)); free(arg);
    }
    if (!valid || method_getImplementation(owned) == h.replacement) { *code = 3; return Nil; }
  }
  Class observed = objc_allocateClassPair(base, name, 0);
  if (!observed) { *code = 4; return Nil; }
  for (size_t i = 0; i < count; i++) {
    Method original = class_getInstanceMethod(base, hooks[i].selector);
    if (!class_addMethod(observed, hooks[i].selector, hooks[i].replacement, method_getTypeEncoding(original))) { objc_disposeClassPair(observed); *code = 4; return Nil; }
  }
  if (class_getInstanceSize(observed) != class_getInstanceSize(base)) { objc_disposeClassPair(observed); *code = 5; return Nil; }
  for (size_t i = 0; i < count; i++) *hooks[i].original = method_getImplementation(class_getInstanceMethod(base, hooks[i].selector));
  objc_registerClassPair(observed); *code = 0; return observed;
}

// Caller separately proves the owned scroll/receiver relationship and marker.
static int HSSAdoptReceiver(id receiver, Class base, Class observed) {
  if (!receiver || !base || !observed || object_getClass(receiver) != base) return 1;
  if (class_getSuperclass(observed) != base || class_getInstanceSize(observed) != class_getInstanceSize(base)) return 2;
  unsigned n = 0; Ivar *ivars = class_copyIvarList(observed, &n); free(ivars); if (n) return 3;
  Class previous = object_setClass(receiver, observed);
  if (previous != base) { object_setClass(receiver, previous); return 4; }
  return 0;
}
static int HSSAdoptOwnedPair(id<HSSPairContract> receiver, id<HSSPairContract> scroll, Class base, Class observed, Class scrollClass) {
  return HSSOwnedPair(receiver, scroll, base, observed, scrollClass) ? HSSAdoptReceiver(receiver, base, observed) : 5;
}

// Observation failures are contained independently before/after the original.
static void HSSNotify(void (^observe)(int), int phase) { @try { observe(phase); } @catch (__unused NSException *error) {} }
static void HSSForwardObject(IMP original, id receiver, SEL selector, id argument, void (^observe)(int)) {
  HSSNotify(observe, 0);
  @try { ((void (*)(id, SEL, id))original)(receiver, selector, argument); }
  @catch (NSException *error) { HSSNotify(observe, 2); @throw error; }
  HSSNotify(observe, 1);
}
static void HSSForwardBool(IMP original, id receiver, SEL selector, id argument, BOOL value, void (^observe)(int)) {
  HSSNotify(observe, 0);
  @try { ((void (*)(id, SEL, id, BOOL))original)(receiver, selector, argument, value); }
  @catch (NSException *error) { HSSNotify(observe, 2); @throw error; }
  HSSNotify(observe, 1);
}
static void HSSForwardVoid(IMP original, id receiver, SEL selector, void (^observe)(int)) {
  HSSNotify(observe, 0);
  @try { ((void (*)(id, SEL))original)(receiver, selector); }
  @catch (NSException *error) { HSSNotify(observe, 2); @throw error; }
  HSSNotify(observe, 1);
}
