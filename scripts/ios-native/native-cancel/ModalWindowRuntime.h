#import "RuntimeHooks.h"

// Per-instance adoption only. No UIKit class implementation is replaced.
// A subclass without added ivars shares the base allocation and inherited teardown.
static int HSCAdoptOwnedModalObject(id object, Class base, Class observer) {
  if (!object || !base || !observer) return 1;
  if (object_getClass(object) != base) return 2;
  if (class_getSuperclass(observer) != base || class_getInstanceSize(observer) != class_getInstanceSize(base)) return 3;
  unsigned count = 0; Ivar *ivars = class_copyIvarList(observer, &count); free(ivars);
  if (count != 0) return 4;
  SEL selector = NSSelectorFromString(@"sendEvent:");
  Method original = class_getInstanceMethod(base, selector), observed = class_getInstanceMethod(observer, selector);
  if (!original || !observed || method_getImplementation(original) == method_getImplementation(observed)
    || strcmp(method_getTypeEncoding(original), method_getTypeEncoding(observed)) != 0) return 5;
  Class previous = object_setClass(object, observer);
  if (previous != base) { object_setClass(object, previous); return 6; }
  return 0;
}
