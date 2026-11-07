# Qualification-copy AX request observation

Refs [transport issue91](https://github.com/hemsoft-dev/yahtzee/issues/91), found by checking all35 open and closed issues before this allocation. It remains closed; this diagnostic makes no completion claim. Issues41/102/112/115 and held PR114 policies are unchanged.

The43249e95 phone6 failure in run42233433667 occurs after successful Help/Done and name entry. During deviceInfo, XCTest reports a timeout fetching `XC_kAXXCAttributeFocusedApplications`, followed by server-test failure and outer device-unreachable. This identifies an API boundary, not its cause or the role of the reported AX pid1793.

## Exact source and scope

The released CLI2.10.0 remains untouched in the ordinary matrix. Its retained nested runner ZIP Git blob4813998ba1f6205633c161bce3a76e7298820971 maps to resource commit e08f33ac, whose source claim is [3ff379997a4879b174458cbd58ecade5641e8609](https://github.com/mobile-dev-inc/maestro/tree/3ff379997a4879b174458cbd58ecade5641e8609/maestro-ios-xctest-runner). This supports the packaged-source mapping, not historical executed-byte equality.

A separate job checks out that exact source, verifies five input hashes and inserts observation only in a generated qualification copy. No upstream write, version/lock drift, UIKit-wide method hook or new private API is added. The existing driver already calls the private XCTest active-applications API. We place begin/return/exception records around that exact call, rather than guessing its implementation. Removing only our insertions restores the original handler expressions, return/error mapping and call count. Forwarding controls require object/exception identity, one original call and nested context restoration. The original100-second HTTP server configuration is unchanged.

The standalone XCTest invokes the actual `DeviceInfoHandler` once after launching the same-run, source/lock-bound actual app on a fresh owned iPhone17/iOS26.5. Its request uses the public FlyingFox0.22.0 initializer pinned by the original Package.resolved. This is direct handler invocation, not an HTTP socket/CLI acknowledgment. It observes the actual ScreenSizeHelper/RunningApp/activeAppsInfo/AXClientProxy path. It does not reproduce typing, tap the historical AI row, replace ordinary qualification or prove the earlier timeout cause. The full original released-driver matrix and modal job still run independently; the aggregate additionally requires this new diagnostic job.

## Finite records

At most256 rows and one budget marker are retained, with numeric version, sequence, runner pid, request ID, stage, edge, error class, target pid/role, wall and uptime samples. No labels, AX values, request/response bodies, bundle strings, command lines, environment or arbitrary error payloads are written by the observer. Unfiltered runtime logs and xcresult remain private and are not uploaded.

Stages are1handler scope,2actual activeApplications call,3already-returned app identity,4public XCTest issue callback,7handler response path,15budget. Edges are0entry,1return,2error. Error1 is the original Objective-C exception forwarded unchanged,2a specifically recognized focused-applications timeout,3other XCTest issue,4the original Swift catch path. Target role0 is unknown,1the fixed owned app,2SpringBoard,3the current runner. Roles1/2 use the original already-resolved pid/bundle dictionary. No additional AX query or OS process discovery is made. A timed-out operation has no target argument, so its underlying process role normally stays unknown. A public issue callback on another thread has request0; it is never assigned to the most recent request by guesswork.

[Apple documents XCTestObservation](https://developer.apple.com/documentation/xctest/xctestobservation) as the supported test-issue observation interface. The specific timeout is recognized in memory with a fixed vocabulary; only its numeric pid and classification survive. Other strings and oversized/unrecognized descriptions are not retained. A missing callback/return is unavailable evidence, not proof of absence or native cancellation ownership. Wall/uptime samples are conditional, not a video or cross-process clock calibration.

## Build and evidence gates

Hosted Xcode26.6/17F113 with simulator SDK26.5 is required without fallback. The original pinned Swift package resolution must remain byte-identical. The receipt retains source/patch hashes, actual built test executable and xctestrun hashes, source-bound app archive/build-manifest references, finite stages and explicit partial/failure state. A built-product hash is not loaded-image attestation. Zero tests, missing native stages, only fake-client controls, unknown roles, gaps, invalid rows or budget exhaustion cannot satisfy the diagnostic capability gate.

Local Node controls verify finite parsing, privacy, bounds, request/process separation, required positive boundaries and exact insertion points. Native forwarding controls, driver compilation, actual AX behavior and response decoding remain unvalidated until the first normal source-bound hosted execution. The supported source may fail to compile against the newer Xcode; any such result remains a real build boundary. No local Windows/browser test is native evidence.

The observed432modal and SQLite capability and historical failures remain preserved. Neither this fixture passing nor an empty later XCTest suite waives ordinary phone6/aggregate failure. No retries, waits, restarts or deadline changes are introduced as a cure, and no app/gesture/reset/store/scoring/JS policy changes are part of this diagnostic.
