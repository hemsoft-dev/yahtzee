# Start and selection observations

Refs [#102](https://github.com/hemsoft-dev/yahtzee/issues/102) and the
[earlier Start observation](https://github.com/hemsoft-dev/yahtzee/issues/91#issuecomment-6583142489).
This is diagnostic source work, not a repair or a demonstrated busy rejection
in the retained failure. #102, #112, #115 and #41 remain open.

## Contract

Setup opts only Start into the existing press observer. Activation sequence
allocates startId, carried into NativeGameScreen's handler. An unmatched handler
allocates its own ID without inventing press evidence. Press-out reports only
deactivation; detach, disable and supersede mark incomplete unhandled observations.
Late earlier out is rejected using in-memory event time. No native event payload
is logged. IDs are bounded numeric sequence values within one process/boot epoch.

The optional per-call store observer defaults off. Actual guards emit busy,
pending/canRetry or no-data decisions; attempt acceptance is separate from a
valid game or successful write. Write begin, acknowledged storage completion,
write failure, operation failure and boolean success/failure are distinct events.
No error strings, names, game IDs, scores, save bytes or player data are supplied.
Observer exceptions are caught without changing the original return value,
storage operation, guard, retry or publication order. No diagnostic await,
timer, listener or retry is added. Retry does not inherit a failed call's observer.

Selection intent IDs cover only dice and AI choices. Their fixed target values
are enums encoded in phase names. A store acknowledgment or unchanged-value no-op
permits a matching selected-value layout effect to report a React commit.
The no-op event does not claim a new write. Detach prevents late acknowledgment
from claiming a selection commit. A Start link identifies the latest intent
handed off by Setup, not its cause or its already-persisted status.

Start success carries the request ID alongside the existing playing update.
Content reports the selected React branch from a layout effect. Render attempts
and setter returns are not commits. The active window ends on Play/Results;
Pause, Resume and Play Again prevent later unrelated state attribution.
The existing Resume and score protocols remain distinct and unchanged.

Qualification gating, shared 8192-record bound, sink/clock isolation and boot
boundaries remain. Capture exit143 stays UNAVAILABLE. Missing phases, gaps and
incomplete capture remain UNKNOWN. React commit does not prove native paint,
AX visibility, original driver delivery or navigation acknowledgment.

## Validation

The actual Setup/Action/NativeGameScreen and real-store component command is
bun test scripts/ios-native/resumeObservation.test.ts scripts/ios-native/startObservation.test.ts.
All 21 cases passed at the unchanged five-second per-test boundary after two
harness corrections: IIFE bundle scoping in the existing Resume fixture, and
a preference assertion that permits React commit before or after caller
settlement while requiring both exactly once after the actual write acknowledgment.
No deadline, case, native assertion, runner or gate was weakened.

A minimal browser bootstrap passed, then published-main Resume source passed
with only IIFE scoping changed. This isolated a harness bundling problem;
the original bootstrap timeouts do not prove a host or native-driver defect.
The existing 15 Resume assertions remain. The workflow adds the new Start
test file to the existing post-browser-install command.

The actual old-source Start control substitutes pinned a01d576
NativeGameScreen, Setup, inputTrace and store blobs into the new harness
without resetting source. It reaches gameplay and fails specifically on
missing Start observation phases; it does not fail during boot.

The pending-selection control uses actual persistence and host callback
delivery to isolate a real busy rejection. Its explicit callback invocation
is not native tap replay or proof that UIKit delivered the historical tap.
Store controls also cover acceptance, no-op, pending/canRetry, write failure
and throwing observers. Trace controls cover privacy, bounds, shipping-disabled
behavior and sink/clock failures. These passing controls do not localize the
retained native input loss. Fresh exact-head review and ordinary hosted
native observation evidence remain required before a delivery claim.

## Historical evidence

The [retained 0ea failure comparison](https://github.com/hemsoft-dev/yahtzee/pull/114)
is preserved under reports/issue-102/start-comparison-0ea-report.md and proof.json.
Tablet10 and successful phone6 both show delayed dice selection/busy UI. Neither
establishes a busy-at-handler rejection. Tablet sender gap16.398460s spans the
touch, video wall offset is uncalibrated, phone PTS regresses, and health143 is
unavailable. That historical video does not prove this implementation.

The later [a0 ordinary run](https://github.com/hemsoft-dev/yahtzee/actions/runs/41822379653)
positively records phone6 Start135 and preference118/91, with separate native
UI/save proof. It failed tablet8 before Start in the Help/screenshot path.
These observations remain historical to a0; they do not locate a failed Start.
The [driver evidence contract](native-driver-evidence.md) adds owned pre-close
identity and early/tail context. Application, package, trace and workflow source
remain byte-identical to a0 for this harness-only extension. New-head hosted
capture proof is pending; internal screenshot stages and root cause are UNKNOWN.
