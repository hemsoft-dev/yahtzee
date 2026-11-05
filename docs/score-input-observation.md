# Score touch boundary observation

Refs [#102](https://github.com/hemsoft-dev/yahtzee/issues/102). This qualification-only
observation tells a released score touch from a cancelled one when that event reaches JS.
It is not an input-loss fix. Cause remains UNKNOWN. Issues 102, 112, 115 and 41 stay open.

## Occurrence that needed it

[PR #114](https://github.com/hemsoft-dev/yahtzee/pull/114) at `4eafe17`,
[run 42106105420 attempt 1](https://github.com/hemsoft-dev/yahtzee/actions/runs/42106105420/attempts/1),
[phone-5 job 127527756488](https://github.com/hemsoft-dev/yahtzee/actions/runs/42106105420/job/127527756488),
artifact 13454460594. Score and trace source there is identical to `329a596`.

- Flow 49 makes one enabled tap at (201, 706) with `retryTapIfNoChange: false`, then waits for
  `score-full-house` to say points recorded. Full House spans x 20-382, y 678-734, inside the
  viewport's x 0-402, y 164-772.
- XCTest taps from 4:10:40.807 to 4:10:41.141 PM EST on November 5, 2026. The flow fails after
  17.285 seconds.
- `score-press-in` (sequence 161) arrives at 4:10:40.839 PM and `score-press-out` (162) at
  4:10:41.050 PM. The 20 observed flow records are sequence-contiguous, with no `score-handler`
  or `score-ack`. The largest heartbeat gap is 1.017 seconds. The ten earlier score taps each
  have a handler and an acknowledgment.
- The failure save (669 bytes) is revision 12, rollsLeft 2, no held dice, ten scores, no Full
  House and no history. No save from just before flow 49 exists, so nothing shows that it was
  unchanged by the tap. The pre-score and failure screenshots are byte-identical.
- Whole input capture and Done health are UNAVAILABLE after requested exit 143. Missing records
  therefore prove nothing about native events or continuous JS. The driver keeps answering after
  the tap. The video is retained but was not decoded or synchronized.

Press-out means only that Pressability deactivated. That build had no way to say whether the
touch ended or was cancelled before the handler. No Pressability, storage, timing, pressure or
observer cause was shown or ruled out.

## Records

Every old score record keeps its phases, order and schema (`phase`, `atMs`, `monotonicMs`,
`sequence`). The added family has exactly those fields plus `scoreId`, the sequence of that
row's `score-press-in` record.

| Phase | Meaning | Not evidence of |
| --- | --- | --- |
| `score-touch-end` | A touch end for the activation's touch reached that row's host view in JS | UIKit hit testing, a handler, a move, paint, AX |
| `score-touch-cancel` | A touch cancel for that touch reached that row's host view in JS | Why it was cancelled |
| `score-observation-detached`, `-disabled`, `-superseded` | An activation with no handler closed for that reason | That a tap was lost |

A score activation is one row's `score-press-in`. The added records take sequence numbers and
share the 8192-record lifetime cap, so later records' sequences shift and a full trace reaches
the cap sooner. Their order against `score-press-out` and `score-handler` carries no causal
meaning. Absence proves nothing: incomplete capture, an unmounted view or any rule below can
hide a boundary.

## Seam

`ScoreRow` gets a per-row observer from `inputTrace.scorePressObservation()` in qualification
builds only. Shipping builds get `undefined`, so the row's props are the same as at `329a596`.

- `onPressIn` still emits `score-press-in`, then hands the event to the observer. The observer
  binds only to the record written immediately before it.
- `onPressOut`, `onPress`, the `score-handler`, `score-ack` and `score-rejected` emits, and the one
  `store.move({ kind: "score", category })` call are unchanged. The store receives no observer.
- `onPress` also tells the observer that a handler ran. That writes nothing; it only keeps a
  handled activation's boundary after the pending write disables the row.
- The row spreads three passive View props: `onTouchStart`, `onTouchEnd` and `onTouchCancel`.
  `onTouchStart` writes nothing. No responder handler, press option, hit area, cancelable flag,
  timer or retry is added or changed.

## Conservative rules

These follow the reviewed Resume boundary in
[resume-react-observation.md](resume-react-observation.md#native-touch-boundary). The native
identifier and time are read as validated primitives, held in memory for one activation per row,
and never written.

- An activation without exactly one changed touch, with a mismatched or invalid identifier or
  time, or with a hostile payload gets no touch binding. Its press-in record stays.
- A boundary with a malformed list, a duplicate match or an invalid time for the bound touch
  stays UNKNOWN and ends the binding. Another finger, or an event older than the activation,
  is ignored.
- A later touch start for the bound identifier with no press-in ends the binding, because native
  identifiers are reused. Each activation records at most one boundary.
- Disable, unmount or a newer press-in closes an activation that has no handler, once. Its late
  boundary is never recorded and its ID is never lent. A handled activation can still record
  its own boundary after the row disables or unmounts.
- A handler with no live activation gets no ID and creates nothing. Each row only receives its
  own subtree's events, and two rows never share an ID.
- StrictMode replay and remounts create observers without writing anything.
- Clock, sink and payload failures are caught. The original press, handler, store call and
  acknowledgment run the same either way.

The collector accepts only these phases, requires `scoreId` below the record's own sequence,
and rejects any other field. Old score records with a `scoreId` are rejected. Requested exit
143 stays UNAVAILABLE; no completeness rule changes.

## Installed React Native preflight

Static source facts from installed React Native 0.86.3, not executed and not native proof.
`Pressable.js` (SHA-256 `3e6c095c…457d`) destructures its own props, spreads `...restProps` onto
`View` and then `{...eventHandlers}` from `usePressability`. `Pressability.js` (`5f6bf835…8933`)
creates responder, focus, click and hover handlers only, with no touch props, so the passive hooks
neither replace nor wrap a responder handler. Context7 was not available; the installed sources
were read directly. Android was not examined.

## Validation

```sh
bun test scripts/ios-native/scoreObservation.test.ts
SCORE_BOUNDARY_BASELINE=1 bun test scripts/ios-native/scoreObservation.test.ts
bun test packages/game-engine/tests/nativeInputTrace.test.ts
node --test scripts/ios-native/inputLog.test.mjs
```

The lifecycle harness runs the real `NativeScorecard`, `ScoreRow`, react-native-web `Pressable`,
`LocalProvider` and store with controlled storage, under StrictMode. Only the native host and
storage are substituted. Adapter touch events carry React Native's payload shape; they are
fixtures. For each scenario it compares save bytes, write attempts, move arguments and count,
promise results, returned values, publications and old score records across the pinned `329a596`
scorecard, the current one and a shipping build. The CI lifecycle step runs it after the existing
six files, at the unchanged 5000 ms test and 30000 ms setup bounds.

With `SCORE_BOUNDARY_BASELINE=1`, the first test runs the pinned scorecard, reaches exactly one
durable Full House score, then fails only because `score-touch-end` is missing. The baseline is
`scripts/ios-native/fixtures/score-boundary-baseline-329.tsx.fixture`, verified with CRLF
normalized to LF against SHA-256
097aa991ee74f6be551fe86e04d0cfed9221e48c92dd674f2fae961e19cb639c. No Git history is read.

react-native-web reduces touch identifiers above 20 on its responder path but not on bubbled
touch events, so the harness uses small identifiers. That is an adapter detail; it says nothing
about native identifiers. A real browser click has no touch payload and records no boundary.

## Limits

No native run was made for this change. It does not reproduce the phone-5 failure, and no local
cancel stands in for it. A new hosted occurrence with this source is needed before release and
cancel can be told apart for a real failed score tap. Even then, a boundary record cannot name a
cause, and its absence cannot show that UIKit dropped a touch.
