
// Qualification-copy observation only. No replacement of XCTest methods.
FOUNDATION_EXPORT NSUInteger HSAXBeginRequest(void);
FOUNDATION_EXPORT void HSAXEndRequest(NSUInteger request);
FOUNDATION_EXPORT void HSAXStage(NSUInteger stage, NSUInteger edge, NSUInteger error);
FOUNDATION_EXPORT NSArray *HSAXForwardActiveApplications(id client);
FOUNDATION_EXPORT void HSAXObserveApp(pid_t pid, NSString *bundleId);
FOUNDATION_EXPORT BOOL HSAXForwardingControls(void);
