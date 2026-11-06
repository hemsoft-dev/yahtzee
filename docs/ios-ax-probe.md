# iOS AX query/tap probe

Native qualification failures on PR #114 ended inside the Maestro driver: `deviceInfo` returned XCTest's `Failed to get list of active applications: Accessibility error kAXErrorIPCTimeout`, a single setup row tap was followed by a false `Current:` assertion, and an initial Intro assertion was false before any touch. Qualification submits up to eight commands per `run` request and keeps only the error text of a thrown assertion. It does not keep the original query results, per-step acknowledgments, or the internal AX and tap stages. This probe fills that gap on hosted macOS without touching Yahtzee, its flows or `quality.yml`.

## What runs

`.github/workflows/ios-ax-probe.yml` runs on pull requests that change the probe's own files, or by manual dispatch. It runs one job on `macos-26`, with no retries or reruns:

1. Unit tests for the probe's schemas, budgets and privacy gate.
2. The same hash-pinned Maestro CLI 2.10.0 install as `quality.yml`, with Java 17. `run.mjs` also checks the archive hash and the two retained jar hashes (`maestro-cli-2.10.0.jar`, `maestro-ios-driver.jar`) and stops with `tool-identity-mismatch` if they differ.
3. `run.mjs` checks for Xcode 26.6 at the native-qualification path and the iOS 26.5 runtime. Anything else stops with `unsupported-host`; there is no fallback.
4. It compiles `fixture/AXProbeFixture.swift` with `swiftc` into an unsigned, ad-hoc-signed simulator app, creates one simulator (`iPad Pro 13-inch (M5)` by default, `iPhone 17` by dispatch choice), installs and launches the fixture, and waits up to 30 seconds for the fixture's own `appeared` event.
5. One Maestro MCP session sends the fixed plan below, then the probe deletes only the simulator and temp folder it created.

The fixture is a single UIKit screen: the text `AX Probe Intro`, a `Choose Mode` button that opens an action sheet with message `Current: Solo` and options `Solo`, `Duo` and Cancel (an iPad popover hides Cancel), and a `Selected: Duo` label that the Duo handler shows. It logs fixed-vocabulary events to its own Documents folder: launch with pid, first appearance, open pressed, sheet presented, option chosen, label set, and a 10 Hz main-run-loop heartbeat that records observed gaps of 250 ms or more.

## The plan

Each row is one MCP request, sent at most once, in this order. Run rows hold exactly one command.

| Stage | Request | Expected |
| --- | --- | --- |
| S01 | `inspect_screen` (includes driver startup) | Intro present, Current and ack absent |
| S02 | `inspect_screen` | same, warm driver |
| S03 | `run`: `assertVisible` text `AX Probe Intro` | returns success |
| S04 | `run`: `tapOn` id `probe.open`, `retryTapIfNoChange: false` | returns success; fixture logs open-pressed and sheet-presented |
| S05 | `inspect_screen` | Current and Duo present, ack absent |
| S06 | `run`: `assertVisible` text `Current: Solo` | returns success |
| S07 | `run`: `tapOn` text `Duo`, `retryTapIfNoChange: false` | returns success; fixture logs option-duo and ack-set |
| S08 | `inspect_screen` | ack present, Current absent |
| S09 | `run`: `assertVisible` text `Selected: Duo` | returns success |

An application failure (a false assertion or a missing element) or an XCTest query error is recorded and the plan continues with the next, different stage; nothing is repeated. `Device became unreachable`, a driver connection error, a request with no response within the five-minute limit, or the twenty-minute session deadline stops the sequence. The remaining stages are recorded as `not-run` with `stopped-after-Sxx`, never as absent results. Request, session and shutdown limits equal native qualification's.

## Which layer each stage reaches

From the pinned runner source (Maestro ref `3ff379997a4879b174458cbd58ecade5641e8609`, the ref the retained package identity maps to):

- `inspect_screen` â†’ Maestro `viewHierarchy` â†’ `ViewHierarchyHandler` â†’ `RunningApp.getForegroundApp()`, which calls `XCUIApplication.activeAppsInfo()` and then each app's `state`, followed by an AX `snapshot()`. `activeAppsInfo` is where XCTest's "list of active applications" error originates.
- `run` with `assertVisible` â†’ Orchestra's element lookup over `viewHierarchy`. How often it polls and how long it waits is Orchestra behaviour that was not read for this probe; the runner log counts show what each stage actually reached.
- `run` with `tapOn` â†’ element lookup over `viewHierarchy`, then `TouchRouteHandler`: `ScreenSizeHelper.physicalScreenSize()` (the same `getForegroundApp` path, cached per app and orientation) and event synthesis through `RunnerDaemonProxy`. Any settle or screen-static checks after the touch are Orchestra behaviour, also not read here.
- `deviceInfo` (`DeviceInfoHandler` â†’ `ScreenSizeHelper.actualScreenSize()`) has no MCP tool of its own. The runner log counts show whether and how often a stage reached it.

Every stage is labelled from four separate sources. They are never merged into one verdict:

- MCP boundary: `query-returned`, `command-returned`, `command-returned-unsuccessful`, `app-assertion-failed`, `driver-query-error`, `transport-error`, `response-unavailable`, `no-response` or `not-run`.
- Error patterns, as booleans: assertion false, element not found, device unreachable plus its operation, active-applications failure, `kAXErrorIPCTimeout`, and driver, hierarchy, device-info or tap route failure.
- Runner log deltas, counted per stage from the isolated `xctest_runner_*.log`: device info handled, running apps listed or failed, IPC timeout, hierarchy snapshot start and done, springboard fallback, screen-size cache or fallback, tap started, returned or failed. The pids in IPC-timeout lines are kept, up to eight, together with whether one is the fixture's own pid.
- Fixture window: whether each expected callback fired, how many milliseconds after the request started, and whether that was before the request returned; heartbeat beats, maximum main-thread gap and stall count during the request; and whether the app was still alive afterwards. Windows are computed only when the fixture's launch event and every read agree with the host's monotonic clock, or failing that the wall clock. Otherwise they are `unwindowed`.

A returned call is not proof that anything was painted or that AX saw it. A callback or a label set by a handler is not paint either. Heartbeats provide bounded positive main-run-loop observations. Their sampled maximum gap does not prove uninterrupted execution across an entire request, especially at request edges or before buffered events are read. A missing heartbeat or callback remains unknown; neither outcome establishes why an AX query timed out.

## Evidence and privacy

The artifact `ios-ax-probe-<sha>-<attempt>` holds `receipt.json`, `stage-events.jsonl` and `closeout.json`. Each stage is journaled before its request is sent. If the job is killed during a request, `closeout.json` lists that stage as `no-response-before-termination`.

Published files contain only fixed vocabulary, hashes, versions, identifiers, numbers and booleans. Before writing, `publishableErrors` checks every string against that vocabulary and a set of fixed formats. A receipt that fails is replaced by a `privacy-rejected` stub. Hierarchy JSON, tool error text, driver logs and MCP stderr are read in memory, reduced to counts and classes, and deleted with the private temp folder. None of them is uploaded.

The receipt records the source commit, run id, runner image, Xcode version and build, simulator SDK, runtime version and build, device type, simulator UDID, the Maestro archive and jar hashes, and the fixture source, Info.plist and executable hashes.

## Sensitivity control

Dispatching with `fixture_main_stall_ms: 3000` makes the open handler block the fixture's main thread for three seconds. This checks that heartbeat gaps and late callbacks show up in the receipt. It is a deliberate control, not a reproduction of the historical IPC timeout. The unit tests' never-answering fake server is likewise only a control for the request bound and the journal.

## Limits

- The fixture is not Yahtzee and the plan is not a replay of any historical flow, save or input. A passing probe does not exonerate the historical failures, and a failing probe does not reproduce them. Issues #102, #112, #115 and #41 stay open on their own evidence.
- It uses the packaged Maestro XCTest runner as shipped. The running runner binary is not attested beyond the archive and jar hashes.
- One device type and one sequence per run. Repeating a run is a separate, independently identified run, not a retry.
- The fixture build, simulator steps and every native behaviour above are unvalidated until a hosted run completes. The unit tests cover only the probe's pure logic and the session against a fake MCP server over the production `rpcClient` transport.

Run the unit tests locally with `node --test scripts/ios-ax-probe/protocol.test.mjs scripts/ios-ax-probe/session.test.mjs`. The probe itself runs only on hosted macOS.

Fixture compiler failures print at most 8192 characters of compiler diagnostics in the CI log, with source, scratch and developer-directory prefixes replaced. This is build feedback from the checked-in fixture, separate from the finite probe receipt; driver response text is never printed.
