# Start and selection observations: implementation checkpoint

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

Qualification gating, shared8192-record bound, sink/clock isolation and boot
boundaries remain. Capture exit143 stays UNAVAILABLE. Missing phases, gaps and
incomplete capture remain UNKNOWN. React commit does not prove native paint,
AX visibility, original driver delivery or navigation acknowledgment.

## Validation dependency

The new startObservation harness uses actual Setup/Action/NativeGameScreen and
the real local store with controlled persistence. Its injected host callback
control intentionally bypasses host disable delivery to isolate the actual busy
guard. It is not native tap replay or evidence that UIKit delivered such a tap.
Existing Resume cases remain untouched. The workflow delta adds this file to
the existing post-Chromium command, with no other job/matrix/gate change.

The new component cases have NOT passed. The unchanged command
`bun test scripts/ios-native/resumeObservation.test.ts scripts/ios-native/startObservation.test.ts`
failed at the existing five-second boundary during page creation/bundle loading,
then browser closure cascaded through the remaining tests. A single control
substituting all relevant published a01d576 main source blobs into the unchanged
Resume harness also timed out at the same boundary. No deadline was increased,
test skipped, runner switched or CI rerun/dispatched. This proves a present
validation dependency, not its underlying host/driver cause, nor that the new
source is correct. The new harness also had an unwrapped-bundle DOM-global
collision, corrected by IIFE scoping; that correction still needs a passing run.

Store unit cases exercise pending selection and busy rejection, accepted write,
no-op, before/after write failure, pending/canRetry rejection and throwing
observers. Trace tests cover fixed IDs, bounds, disabled behavior and broken
clock/sink isolation. These are narrower than component lifecycle proof.

Before publication, execute the actual two-file lifecycle command successfully,
obtain a baseline-negative Start observation control against published main,
and correct any genuine new failures. A failed setup/boot timeout is not that
baseline-negative signal. Keep the five-second/native assertion bounds intact.
Fresh exact-head SFL and ordinary hosted native evidence are still required.

## Historical evidence

The [retained0ea failure comparison](https://github.com/hemsoft-dev/yahtzee/pull/114)
is preserved under reports/issue-102/start-comparison-0ea-report.md and proof.json.
Tablet10 and successful phone6 both show delayed dice selection/busy UI. Neither
establishes a busy-at-handler rejection. Tablet sender gap16.398460s spans the
touch, video wall offset is uncalibrated, phone PTS regresses, and health143 is
unavailable. Historical video is not proof of this new implementation. No new
native screenshot or recording exists before ordinary new-source CI.
