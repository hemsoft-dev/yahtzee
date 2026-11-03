# Partial Resume observation

Refs [#112](https://github.com/hemsoft-dev/yahtzee/issues/112). This adds positive
JS handler and React commit observations. It does not fix Resume or satisfy the
issue's native press, visibility or one-tap acknowledgment criteria. The original
score loss in [#102](https://github.com/hemsoft-dev/yahtzee/issues/102) remains open.

The qualification-only trace emits `resume-handler` synchronously when the
existing Resume callback runs. Its `resumeId` is the handler's sequence number,
scoped to that process/boot epoch. The ID travels in the same React state update
as `playing`. A layout effect in Content emits
`resume-react-commit-loading`, `resume-react-commit-setup`,
`resume-react-commit-play` or `resume-react-commit-results` with that ID only
after the selected subtree commits. A setter return or render attempt emits no
commit. The observation window closes when Play or Results commits, so later
game completion cannot inherit the request. Loading/Setup observations can
precede that destination. Start and Pause invalidate correlation; Play Again
invalidates it synchronously before calling discard, including while its write
is pending or fails. Playing still changes only after discard succeeds.
Strict effect replay/remount does not duplicate an already observed branch for
an ID. Each branch is recorded at most once per request; this is not a continuous
screen-transition journal.
The saved-result review uses the same callback and can report the results branch.

The lifecycle boundary follows React's
[layout-effect contract](https://react.dev/reference/react/useLayoutEffect) and
[Suspense behavior](https://react.dev/reference/react/Suspense). A layout-effect
record is intentionally narrower than a native visibility claim.

These phases mean React committed a selected subtree. They do not mean UIKit
received a press, painted the screen, exposed accessibility elements or
acknowledged navigation. There is no press-in/out probe. Failed or abandoned
renders do not produce a selected-subtree commit record. No new native timeout,
tap, retry, save operation or flow assertion is introduced.

The channel retains only fixed phase enums, numeric IDs, sequence and wall/
monotonic timestamps. Existing qualification gating, 8192-record lifetime cap,
heartbeat cleanup and advisory capture failures remain. Score records retain
their existing schema. Sink failures do not escape into the game callback.
Sender and receiver explicitly allow the new phases and reject other fields.

Missing events remain UNKNOWN when capture is incomplete, the process epoch or
tap window is not established, or sequence coverage is unavailable. In
particular, requested numeric exit 143 remains `unavailable` under the existing
collector rule. No health criterion was relaxed. The historical failed AI
landscape scenario has no video and its cached AX is pre-relaunch. These new
observations cannot recover that missing evidence.

## Verification

- `bun test packages/game-engine/tests/nativeInputTrace.test.ts`
- `node --test scripts/ios-native/inputLog.test.mjs scripts/ios-native/inputObservation.test.mjs`
- `bun test scripts/ios-native/resumeObservation.test.ts`

The last command explicitly runs a dedicated real React DOM/Chromium lifecycle
harness using the actual NativeGameScreen, Setup and Action. A controlled store,
native host adapter and destination screens exercise suspended,
abandoned and throwing destination renders. It covers correlated successful
commits, repeated requests, StrictMode, disabled Resume and sink failure. This
is component lifecycle evidence, not UIKit or native acceptance. Additional
cases use the real local store with controlled storage to cover later game
completion, loading-to-destination commits, and Play Again publications before
its await continuation, with both successful and failed pending writes.

The harness uses the existing Playwright Chromium installation. Both existing
Ubuntu and Windows validation jobs explicitly run it immediately after successful
browser installation, unless cancelled. A failure fails that validation job.
There is no additional browser install, dependency or test-discovery configuration.
The same command also runs locally.

Full press-path work still requires the reserved Setup/Action path and explicit
source ownership from the parent after
[PR #111](https://github.com/hemsoft-dev/yahtzee/pull/111), or another explicit
allocation. A passing native matrix alone cannot close either diagnostic issue.
