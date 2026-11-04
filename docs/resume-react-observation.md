# Resume press and React observation

Refs [#112](https://github.com/hemsoft-dev/yahtzee/issues/112). This diagnostic
observes qualification-only Pressable callbacks, JS handler entry and React
committed selection. It does not fix Resume. Native delivery, paint, AX visibility,
one-tap acknowledgment and cause remain unproved. Both #112 and the original
[score loss #102](https://github.com/hemsoft-dev/yahtzee/issues/102) remain open.

## Correlation

Only Setup's Resume/Review saved result Action opts into the press observer.
Normal builds create no observer and emit no trace. Other Actions keep their
existing onPress callbacks and receive no observer. No native event payload,
coordinate, player name, game ID, score or arbitrary error enters this channel.

- `resume-press-in` allocates `resumeId` from that record's sequence number.
- `resume-press-out` reports Pressable deactivation with the same ID.
- `resume-handler` reports entry into NativeGameScreen's existing callback,
  using the ID passed from that activation. If no activation is available, the
  handler allocates its own ID equal to its sequence. That is an unmatched
  handler, never fabricated press evidence.
- `resume-react-commit-loading`, `-setup`, `-play` and `-results` report the
  selected subtree from Content's layout effect with the handler's ID.

Press-out can occur before the handler or be delayed until after it. It does
not establish cancellation, success or release to the OS. A delayed callback
after a handled control unmounts can still record out for its old activation.
If Pressability cancels that delayed callback during cleanup, missing out is
UNKNOWN. Observation never fabricates it. Callback event time is compared
in memory to reject an older delayed out after a newer activation; an absent
or invalid event time leaves out UNKNOWN. That event time is never logged.
Each activation has at most one out record. Re-entry/new activation gets a new ID; these IDs are not native touch IDs.
Driver timestamps must still establish which activation belongs to an original
tap. No original driver event or native input acknowledgment is manufactured.

`resume-observation-detached`, `-disabled` and `-superseded` end an activation
that has not reached the handler. They report layout-effect cleanup, a committed
disabled state or replacement by another activation, respectively. They do not
name a native cancellation cause. Cleanup can also occur when React hides
a suspended tree; detached does not assert physical removal. Late out/activation
callbacks cannot revive a closed observation. A cancelled gesture can yield in/out without a handler;
that pair alone leaves the handler outcome UNKNOWN. No timer infers rejection
from elapsed time. An unfinished observation at process/capture end remains
incomplete, including when none of these terminal records is available.

The ID travels in the same React state update as `playing`. Setter return and
render attempts produce no commit record. Loading/Setup can precede Play or
Results. The active window closes on that destination, so later game completion
cannot inherit the ID. Start and Pause invalidate correlation; Play Again
invalidates it synchronously before discard publishes. Playing changes only
after discard succeeds. Failure retains Results and the existing save recovery.
Strict effect replay cannot duplicate a branch. Suspended, abandoned or throwing
renders cannot claim a destination commit.

The lifecycle boundaries follow React's
[layout-effect contract](https://react.dev/reference/react/useLayoutEffect) and
[Suspense behavior](https://react.dev/reference/react/Suspense), and React Native's
[Pressable callback contract](https://reactnative.dev/docs/Pressable).
The installed Pressability implementation permits delayed press-out. Context7
was unavailable; official documentation and the installed implementation were
consulted. The browser host adapter is not a native-delivery test.

## Capture and evidence limits

Records contain only fixed phase enums, numeric IDs, sequence and wall/monotonic
timestamps. The ID is scoped to the trace instance/process epoch. A new process
can reuse it; never join matching numeric IDs across boot boundaries. Existing
boot records and sequence resets identify epochs; incomplete boot/sequence
coverage leaves correlation UNKNOWN. Existing qualification gating, 8192-record
lifetime cap, heartbeat cleanup and sink/clock isolation remain. Score schema
and capture bounds are unchanged. Receiver validation allows the fixed phases
and rejects extra fields. Observation failure cannot change a game outcome.

No collector-health criterion is relaxed. Requested numeric exit 143 remains
`unavailable`; code 0 or null plus SIGTERM still requires all other completeness
conditions. Positive retained events can establish one observed JS seam despite
unavailable whole-capture health. Absence cannot establish a lost handler or
native delivery. These records never establish native paint, AX or navigation
acknowledgment. Driver, contemporaneous UI/video and durable saves remain
separate evidence requirements.

The [9725bd0 landscape failure](https://github.com/hemsoft-dev/yahtzee/issues/112#issuecomment-6616700973)
has no contemporaneous video and its cached AX precedes relaunch. Its source
has none of these Resume observations. Historical 2926974/e94924b positive
handler/commit controls cannot explain that failure or prove this new source.
All retained failures and whole-run CI failures remain historical evidence.

## Verification

- `bun test packages/game-engine/tests/nativeInputTrace.test.ts`
- `node --test scripts/ios-native/inputLog.test.mjs scripts/ios-native/inputObservation.test.mjs`
- `bun test scripts/ios-native/resumeObservation.test.ts`

The last command runs actual NativeGameScreen, Setup and Action through React
DOM/Chromium with the native host adapter and substituted destination screens.
It exercises original pointer in/out, a cancelled gesture, disable during an
actual pending store write, unmount/late release, unmatched handler, shipping
gating, StrictMode, suspension, abandonment, render errors and failing sinks.
Real local-store cases cover loading-to-destination, later completion and pending
Play Again success/failure. Protocol tests cover either out/handler order,
delayed out after unmount, privacy, clocks, bounds and conservative health.

Before adding the observation, the three new actual-component press/cancellation/
unmount regressions failed because the expected press records were absent.
The final harness also fails against the published e94924b component/trace
blobs substituted in memory: handler/commit exist but press-in/out are absent.
This red/green proves the missing observation is now exercised; it does not
reproduce or repair the intermittent native failure. Both existing Ubuntu and
Windows validation jobs already execute the same lifecycle command after the
existing successful Chromium install. No workflow, dependency, timeout, runner,
assertion, native device/mode matrix, retry tap or save behavior changes here.

New-source hosted native press/handler/commit correlation and UI/video/save
proof remain pending ordinary CI. A passing matrix or React commit alone cannot
close either diagnostic issue.
