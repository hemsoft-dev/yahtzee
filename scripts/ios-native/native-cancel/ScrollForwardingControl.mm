#import "ScrollReceiverRuntime.h"
#include <assert.h>

struct HSSCppMarker {};
static HSSCppMarker CppMarker;
static id CppTrigger;
static int Destructions;
struct HSSControlLifetime { ~HSSControlLifetime() { Destructions++; } };
@interface HSSControlScroll : NSObject
@property(nonatomic, weak) id superview;
@property(nonatomic, weak) id overridingDelegate;
@end
@implementation HSSControlScroll @end
@interface HSSControlReceiver : NSObject { HSSControlLifetime _lifetime; }
@property(nonatomic, strong) id scrollView;
@property(nonatomic, copy) NSString *accessibilityIdentifier;
@property NSUInteger calls;
@property(nonatomic, strong) id last;
@property BOOL decelerate;
@property(nonatomic, strong) NSException *failure;
@property BOOL readThrows;
- (void)scrollViewDidScroll:(id)scroll;
- (void)scrollViewWillBeginDragging:(id)scroll;
- (void)scrollViewDidEndDragging:(id)scroll willDecelerate:(BOOL)value;
- (void)scrollViewWillBeginDecelerating:(id)scroll;
- (void)scrollViewDidEndDecelerating:(id)scroll;
- (void)scrollViewDidEndScrollingAnimation:(id)scroll;
- (void)didMoveToWindow;
@end
@implementation HSSControlReceiver
@synthesize scrollView = _scrollView;
- (id)scrollView { if (_readThrows) @throw _failure; return _scrollView; }
- (void)receive:(id)arg { self.calls++; self.last = arg; if (self.failure) @throw self.failure; }
- (void)scrollViewDidScroll:(id)s { [self receive:s]; }
- (void)scrollViewWillBeginDragging:(id)s { [self receive:s]; }
- (void)scrollViewDidEndDragging:(id)s willDecelerate:(BOOL)b { self.decelerate = b; [self receive:s]; }
- (void)scrollViewWillBeginDecelerating:(id)s { [self receive:s]; }
- (void)scrollViewDidEndDecelerating:(id)s { [self receive:s]; }
- (void)scrollViewDidEndScrollingAnimation:(id)s { if (s == CppTrigger) throw &CppMarker; [self receive:s]; }
- (void)didMoveToWindow { [self receive:nil]; }
@end
@interface HSSInheritedReceiver : HSSControlReceiver @end
@implementation HSSInheritedReceiver @end
@interface HSSWrongSize : HSSControlReceiver { int extra; } @end
@implementation HSSWrongSize @end
static IMP Original[7];
static NSMutableArray *Phases;
static BOOL ObserverThrows;
static NSException *ObserverError;
static void Observe(int phase) { [Phases addObject:@(phase)]; if (ObserverThrows) @throw ObserverError; }
static void S(id self, SEL cmd, id arg) { HSSForwardObject(Original[0],self,cmd,arg,^(int p){ Observe(p); }); }
static void B(id self, SEL cmd, id arg) { HSSForwardObject(Original[1],self,cmd,arg,^(int p){ Observe(p); }); }
static void E(id self, SEL cmd, id arg, BOOL value) { HSSForwardBool(Original[2],self,cmd,arg,value,^(int p){ Observe(p); }); }
static void W(id self, SEL cmd, id arg) { HSSForwardObject(Original[3],self,cmd,arg,^(int p){ Observe(p); }); }
static void D(id self, SEL cmd, id arg) { HSSForwardObject(Original[4],self,cmd,arg,^(int p){ Observe(p); }); }
static void A(id self, SEL cmd, id arg) { HSSForwardObject(Original[5],self,cmd,arg,^(int p){ Observe(p); }); }
static void M(id self, SEL cmd) { HSSForwardVoid(Original[6],self,cmd,^(int p){ Observe(p); }); }

int main(void) {
 @autoreleasepool {
  HSCNativeHook hooks[] = {
   {HSSControlReceiver.class,@selector(scrollViewDidScroll:),3,'v',(IMP)S,&Original[0],"@"},
   {HSSControlReceiver.class,@selector(scrollViewWillBeginDragging:),3,'v',(IMP)B,&Original[1],"@"},
   {HSSControlReceiver.class,@selector(scrollViewDidEndDragging:willDecelerate:),4,'v',(IMP)E,&Original[2],"@b"},
   {HSSControlReceiver.class,@selector(scrollViewWillBeginDecelerating:),3,'v',(IMP)W,&Original[3],"@"},
   {HSSControlReceiver.class,@selector(scrollViewDidEndDecelerating:),3,'v',(IMP)D,&Original[4],"@"},
   {HSSControlReceiver.class,@selector(scrollViewDidEndScrollingAnimation:),3,'v',(IMP)A,&Original[5],"@"},
   {HSSControlReceiver.class,@selector(didMoveToWindow),2,'v',(IMP)M,&Original[6],""}
  };
  IMP before = class_getMethodImplementation(HSSControlReceiver.class,@selector(scrollViewDidScroll:)); int code;
  hooks[2].argumentTypes="@@"; assert(!HSSPrepareReceiver(HSSControlReceiver.class,"HSSWrongABI",hooks,7,&code) && Original[0]==NULL);
  hooks[2].argumentTypes="@b"; Class observed=HSSPrepareReceiver(HSSControlReceiver.class,"HSSObservedControl",hooks,7,&code);
  assert(observed && code==0 && class_getMethodImplementation(HSSControlReceiver.class,@selector(scrollViewDidScroll:))==before);
  assert(HSSObjectGetter(HSSControlReceiver.class,@selector(scrollView)) && !HSSObjectGetter(HSSControlReceiver.class,@selector(calls)));
  HSCNativeHook inherited[7]; IMP inheritedOriginal[7]={}; memcpy(inherited,hooks,sizeof(hooks));
  for(int i=0;i<7;i++) { inherited[i].cls=HSSInheritedReceiver.class; inherited[i].original=&inheritedOriginal[i]; }
  assert(!HSSPrepareReceiver(HSSInheritedReceiver.class,"HSSInherited",inherited,7,&code) && code==2);
  HSSControlReceiver *owner=[HSSControlReceiver new], *unrelated=[HSSControlReceiver new]; HSSControlScroll *scroll=[HSSControlScroll new];
  owner.scrollView=scroll; owner.accessibilityIdentifier=@"other"; scroll.superview=owner; scroll.overridingDelegate=owner;
  assert(HSSAdoptOwnedPair((id)owner,(id)scroll,HSSControlReceiver.class,observed,HSSControlScroll.class)!=0 && object_getClass(owner)==HSSControlReceiver.class);
  owner.accessibilityIdentifier=@"help-viewport"; scroll.overridingDelegate=unrelated;
  assert(!HSSOwnedPair((id)owner,(id)scroll,HSSControlReceiver.class,observed,HSSControlScroll.class)); scroll.overridingDelegate=owner;
  scroll.superview=unrelated; assert(!HSSOwnedPair((id)owner,(id)scroll,HSSControlReceiver.class,observed,HSSControlScroll.class)); scroll.superview=owner;
  owner.scrollView=unrelated; assert(!HSSOwnedPair((id)owner,(id)scroll,HSSControlReceiver.class,observed,HSSControlScroll.class)); owner.scrollView=scroll;
  assert(!HSSOwnedPair((id)unrelated,(id)scroll,HSSControlReceiver.class,observed,HSSControlScroll.class));
  assert(HSSAdoptReceiver(owner,HSSControlReceiver.class,HSSWrongSize.class)!=0);
  assert(HSSAdoptOwnedPair((id)owner,(id)scroll,HSSControlReceiver.class,observed,HSSControlScroll.class)==0 && object_getClass(unrelated)==HSSControlReceiver.class);
  assert(HSSAdoptOwnedPair((id)owner,(id)scroll,HSSControlReceiver.class,observed,HSSControlScroll.class)!=0);
  Phases=[NSMutableArray new]; ObserverError=[NSException exceptionWithName:@"observer" reason:nil userInfo:nil];
  [owner scrollViewDidScroll:scroll]; assert((owner.calls==1 && owner.last==scroll && [Phases isEqual:@[@0,@1]]));
  [owner scrollViewWillBeginDragging:scroll]; [owner scrollViewDidEndDragging:scroll willDecelerate:YES]; assert(owner.calls==3 && owner.decelerate && owner.last==scroll);
  [owner scrollViewDidEndDragging:scroll willDecelerate:NO]; assert(owner.calls==4 && !owner.decelerate);
  [owner scrollViewWillBeginDecelerating:scroll]; [owner scrollViewDidEndDecelerating:scroll]; [owner scrollViewDidEndScrollingAnimation:scroll]; [owner didMoveToWindow]; assert(owner.calls==8 && owner.last==nil);
  ObserverThrows=YES; [owner scrollViewDidScroll:scroll]; assert(owner.calls==9 && owner.last==scroll); ObserverThrows=NO;
  NSException *failure=[NSException exceptionWithName:@"original" reason:nil userInfo:nil]; owner.failure=failure; BOOL caught=NO;
  [Phases removeAllObjects]; @try { [owner scrollViewDidScroll:scroll]; } @catch(NSException *actual) { caught=actual==failure; }
  assert((caught && owner.calls==10 && [Phases isEqual:@[@0,@2]]));
  ObserverThrows=YES; caught=NO; @try { [owner scrollViewDidEndDragging:scroll willDecelerate:YES]; } @catch(NSException *actual) { caught=actual==failure; }
  assert(caught && owner.calls==11 && owner.decelerate); ObserverThrows=NO; owner.readThrows=YES;
  assert(!HSSOwnedPair((id)owner,(id)scroll,HSSControlReceiver.class,observed,HSSControlScroll.class)); owner.readThrows=NO; owner.failure=nil;
  owner.accessibilityIdentifier=@"recycled"; assert(!HSSOwnedPair((id)owner,(id)scroll,HSSControlReceiver.class,observed,HSSControlScroll.class));
  CppTrigger=[NSObject new]; [Phases removeAllObjects]; BOOL cppCaught=NO;
  try { [owner scrollViewDidEndScrollingAnimation:CppTrigger]; } catch(HSSCppMarker *actual) { cppCaught=actual==&CppMarker; }
  assert(cppCaught && [Phases isEqual:@[@0]]); // C++ unwinding is preserved; no ObjC return/throw record is invented.
  [unrelated scrollViewDidScroll:scroll]; assert(unrelated.calls==1 && object_getClass(unrelated)==HSSControlReceiver.class);
 }
 assert(Destructions==2); // The adopted receiver inherits the base C++ ivar teardown exactly once.
 puts("native-scroll-forwarding-control:pass");
 return 0;
}
