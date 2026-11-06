
// Linked only into a generated copy of the pinned test runner.
#include <unistd.h>
#include <math.h>
static NSUInteger HSAXSequence = 0, HSAXNextRequest = 0;
static NSString *const HSAXStackKey = @"hemsoft.qualification.ax-request-stack";
static NSMutableArray *HSAXStack(void) {
    NSMutableDictionary *thread = NSThread.currentThread.threadDictionary;
    if (!thread[HSAXStackKey]) thread[HSAXStackKey] = [NSMutableArray array];
    return thread[HSAXStackKey];
}
static NSUInteger HSAXCurrent(void) {
    @try { return [HSAXStack().lastObject unsignedIntegerValue]; }
    @catch (__unused NSException *exception) { return 0; }
}
static void HSAXWrite(NSUInteger request, NSUInteger stage, NSUInteger edge,
                      NSUInteger error, pid_t target, NSUInteger role) {
    @try {
        @synchronized (AXClientProxy.class) {
            if (HSAXSequence > 256) return;
            if (HSAXSequence == 256) { stage = 15; edge = 0; error = 0; target = 0; role = 0; }
            double wall = NSDate.date.timeIntervalSince1970 * 1000000;
            double mono = NSProcessInfo.processInfo.systemUptime * 1000000;
            if (!isfinite(wall) || !isfinite(mono) || wall < 0 || mono < 0 || wall > 9e15 || mono > 9e15) return;
            NSDictionary *row = @{@"v": @1, @"seq": @(HSAXSequence++), @"pid": @(getpid()),
                @"request": @(request), @"stage": @(stage), @"edge": @(edge), @"error": @(error),
                @"target": @(target > 0 ? target : 0), @"role": @(role),
                @"wallUs": @((long long)wall), @"monoUs": @((long long)mono)};
            NSData *data = [NSJSONSerialization dataWithJSONObject:row options:0 error:nil];
            if (data && data.length <= 512) {
                NSString *line = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
                if (line) NSLog(@"HS_AX_STAGE_V1 %@", line);
            }
        }
    } @catch (__unused NSException *exception) { /* Observation cannot replace an outcome. */ }
}
@interface HSAXIssueObserver : NSObject <XCTestObservation>
@end
@implementation HSAXIssueObserver
- (void)testCase:(XCTestCase *)testCase didRecordIssue:(XCTIssue *)issue {
    @try {
        NSString *text = issue.compactDescription;
        NSUInteger kind = 3; pid_t target = 0;
        if (text.length <= 8192 && [text containsString:@"Timed out while fetching attributes"] &&
            [text containsString:@"XC_kAXXCAttributeFocusedApplications"]) {
            kind = 2;
            NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"AX element pid: ([1-9][0-9]{0,8})(?:,| )" options:0 error:nil];
            NSTextCheckingResult *match = [pattern firstMatchInString:text options:0 range:NSMakeRange(0, text.length)];
            if (match.numberOfRanges == 2) target = (pid_t)[[text substringWithRange:[match rangeAtIndex:1]] intValue];
        }
        // The private query has no target argument. Never guess the OS process role from its PID.
        HSAXWrite(HSAXCurrent(), 4, 2, kind, target, target == getpid() ? 3 : 0);
    } @catch (__unused NSException *exception) { }
}
@end
NSUInteger HSAXBeginRequest(void) {
    @try {
        static HSAXIssueObserver *observer; static dispatch_once_t once;
        dispatch_once(&once, ^{ observer = [HSAXIssueObserver new]; [XCTestObservationCenter.sharedTestObservationCenter addTestObserver:observer]; });
        NSMutableArray *stack = HSAXStack(); if (stack.count >= 8) return 0;
        NSUInteger request;
        @synchronized (AXClientProxy.class) { if (HSAXNextRequest >= 64) return 0; request = ++HSAXNextRequest; }
        [stack addObject:@(request)]; HSAXWrite(request, 1, 0, 0, getpid(), 3); return request;
    } @catch (__unused NSException *exception) { return 0; }
}
void HSAXEndRequest(NSUInteger request) {
    @try {
        if (!request) return;
        HSAXWrite(request, 1, 1, 0, getpid(), 3);
        if ([HSAXStack().lastObject unsignedIntegerValue] == request) [HSAXStack() removeLastObject];
    } @catch (__unused NSException *exception) { }
}
void HSAXStage(NSUInteger stage, NSUInteger edge, NSUInteger error) {
    NSUInteger request = HSAXCurrent(); if (request) HSAXWrite(request, stage, edge, error, 0, 0);
}
NSArray *HSAXForwardActiveApplications(id client) {
    NSUInteger request = HSAXCurrent();
    if (request) HSAXWrite(request, 2, 0, 0, 0, 0);
    @try {
        NSArray *result = [client activeApplications];
        if (request) HSAXWrite(request, 2, 1, 0, 0, 0);
        return result;
    } @catch (NSException *exception) {
        if (request) HSAXWrite(request, 2, 2, 1, 0, 0);
        @throw exception;
    }
}
void HSAXObserveApp(pid_t pid, NSString *bundleId) {
    @try {
        NSUInteger request = HSAXCurrent(); if (!request || pid <= 0) return;
        NSUInteger role = [bundleId isEqualToString:@"com.hemsoft.thirdroll"] ? 1 :
            [bundleId isEqualToString:@"com.apple.springboard"] ? 2 : pid == getpid() ? 3 : 0;
        HSAXWrite(request, 3, 1, 0, pid, role);
    } @catch (__unused NSException *exception) { }
}
@interface HSAXControlClient : NSObject
@property NSUInteger calls;
@property(strong) NSArray *answer;
@property(strong) NSException *failure;
- (NSArray *)activeApplications;
@end
@implementation HSAXControlClient
- (NSArray *)activeApplications { self.calls++; if (self.failure) @throw self.failure; return self.answer; }
@end
BOOL HSAXForwardingControls(void) {
    @try {
        HSAXControlClient *client = [HSAXControlClient new]; client.answer = @[@1];
        NSUInteger outer = HSAXBeginRequest(), inner = HSAXBeginRequest();
        NSArray *answer = HSAXForwardActiveApplications(client);
        BOOL good = answer == client.answer && client.calls == 1 && HSAXCurrent() == inner;
        HSAXEndRequest(inner); good = good && HSAXCurrent() == outer;
        client.failure = [NSException exceptionWithName:@"owned-control" reason:nil userInfo:nil];
        @try { HSAXForwardActiveApplications(client); good = NO; }
        @catch (NSException *exception) { good = good && exception == client.failure && client.calls == 2; }
        HSAXEndRequest(outer); good = good && HSAXCurrent() == 0;
        client.failure = nil; answer = HSAXForwardActiveApplications(client);
        return good && answer == client.answer && client.calls == 3;
    } @catch (__unused NSException *exception) { return NO; }
}
