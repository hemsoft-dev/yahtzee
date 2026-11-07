#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#include <stdlib.h>
#include <string.h>

// Preflight the entire set before replacing anything. Never modify an inherited
// UIKit method: every selector must belong to the named RN class itself.
typedef struct {
  Class cls;
  SEL selector;
  unsigned arguments;
  char result; // 'b' accepts the platform BOOL encodings B/c.
  IMP replacement;
  IMP *original;
  const char *argumentTypes; // Optional: '@' object/block, 'b' BOOL. Existing hooks default to objects.
} HSCNativeHook;

static int HSCInstallNativeHooks(HSCNativeHook *hooks, size_t count) {
  if (count == 0 || count > 16) return 1;
  for (size_t i = 0; i < count; i++) {
    HSCNativeHook h = hooks[i];
    if (!h.cls || !h.selector || !h.replacement || !h.original || *h.original) return 2;
    for (size_t j = 0; j < i; j++)
      if (hooks[j].cls == h.cls && hooks[j].selector == h.selector) return 3;
    unsigned n = 0;
    Method *methods = class_copyMethodList(h.cls, &n);
    Method owned = NULL;
    for (unsigned j = 0; j < n; j++)
      if (method_getName(methods[j]) == h.selector) owned = methods[j];
    free(methods);
    if (!owned || method_getNumberOfArguments(owned) != h.arguments) return 4;
    if (h.argumentTypes && strlen(h.argumentTypes) != h.arguments - 2) return 5;
    char *ret = method_copyReturnType(owned);
    BOOL valid = ret && (h.result == 'b' ? (strcmp(ret, "B") == 0 || strcmp(ret, "c") == 0) : (ret[0] == h.result && ret[1] == 0));
    free(ret);
    for (unsigned j = 2; valid && j < h.arguments; j++) {
      char *arg = method_copyArgumentType(owned, j);
      char expected = h.argumentTypes ? h.argumentTypes[j - 2] : '@';
      valid = arg && (expected == '@' ? arg[0] == '@' : expected == 'b' && (strcmp(arg, "B") == 0 || strcmp(arg, "c") == 0));
      free(arg);
    }
    if (!valid || method_getImplementation(owned) == h.replacement) return 5;
  }
  for (size_t i = 0; i < count; i++)
    *hooks[i].original = method_setImplementation(class_getInstanceMethod(hooks[i].cls, hooks[i].selector), hooks[i].replacement);
  return 0;
}
