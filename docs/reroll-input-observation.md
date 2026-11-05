# Re-roll input observation

This partial, qualification-only observation advances [#115](https://github.com/hemsoft-dev/yahtzee/issues/115).
It is not an input-loss fix and does not complete that issue. Cause remains UNKNOWN.

## Historical failure

Source 9725bd0, [run 41722260513 attempt 1](https://github.com/hemsoft-dev/yahtzee/actions/runs/41722260513/attempts/1),
artifact 13275560821, phone 6 solo-dark flow 11. One enabled `reroll-action` tap ran with
`retryTapIfNoChange: false`. XCTest records the touch at (201, 804), inside the inspected
bounds, from 4:55:02.843 to 4:55:03.238 PM EST on November 3, 2026. The `Re-roll (1)` assertion
failed after 17.563 seconds. The failure image still shows Re-roll (2). The after-hold and
failure saves are byte-identical: revision 1, rollsLeft 2, held `[0]`, unchanged dice, empty
scores and history. That build had no Re-roll instrumentation, so a missing handler phase means
nothing there. Capture health is UNAVAILABLE after requested exit 143. Video and touch timing
were not synchronized, and no pressure cause was shown.

## What each phase means

One numeric `rerollId` correlates these records. Each record has exactly `phase`, `atMs`,
`monotonicMs`, `sequence` and `rerollId`.

| Phase | Meaning | Not evidence of |
| --- | --- | --- |
| `reroll-press-in`, `reroll-press-out` | Action's Pressable delivered that callback to JS | UIKit touch, hit testing |
| `reroll-handler` | The original `onPress` was entered | A state change |
| `reroll-decision-accepted`, `-busy`, `-can-retry`, `-pending`, `-no-data` | What the store decided | A write |
| `reroll-write-begin`, `-ack`, `-failed` | The durable port was called, resolved or rejected | UIKit paint, AX, navigation |
| `reroll-operation-failed`, `reroll-settled-success`, `-failure` | The store's attempt ended | A commit |
| `reroll-observation-detached`, `-disabled`, `-superseded` | An unhandled activation closed for that reason | That the tap was lost |

`reroll-decision-accepted` means the busy guard passed. A later `can-retry`, `pending`, `no-data`
or `operation-failed` on the same ID is the rejection. A failed write can still have landed, as
`write-failed` only reports that the port rejected.

## Seam

`Play` opts Re-roll into the existing Action press controller through `rerollPressObservation`.
`onPress` still makes its one `store.move({ kind: "roll" })` call and adds an optional per-call
observer, the same one `start` and `preferences` already take. The store's unchanged `attempt`,
`update` and `writePending` emit the decisions. Nothing about the transaction is duplicated.
Move count and order, the move argument, the promise and its discarded result, RNG, save bytes,
revision, held dice, guards, retries and publication order do not change.

Other `move` callers pass one argument and stay unobserved. Shipping builds get `undefined` from
the factory, so Action receives the same props as before. Re-roll gets no native touch hooks;
those stay Resume-only.

## Conservative rules

- A handler with no live activation gets its own ID and no press records.
- A repeated handler gets its own ID. Busy rejection appears on that ID, and the first request
  keeps its own acknowledgment.
- Disabled, unmounted or superseded activations close once and never lend their ID. The original
  callback still runs if the host delivers it.
- Unknown or stale event time establishes no press-out. A handled activation may still report its
  own late out after unmount.
- An out with no handler stays open, as with Help and Start, because out may precede the handler.
  A later handler with no new press-in therefore joins that activation. Each ordinary tap starts
  with a press-in, which supersedes it.
- A retry after `write-failed` is not observed, since `retry()` takes no observer. It adds neither
  an ack nor a commit to the original request.
- React commit is not observed in this patch. A later revision can include other moves, so its
  commitment alone is insufficient to name the exact acknowledged Re-roll. Post-tap UI, paint
  and accessibility remain separate evidence; no `reroll-react-commit` phase is emitted or accepted.
- Missing records never prove that a handler was absent or a request rejected.
- The shared 8192-record lifetime cap, qualification flag and clock and sink isolation apply.
  Names, game IDs, scores, dice, labels, errors and event payloads never enter a record.
- The collector accepts only these finite phases and rejects any other field. Requested exit 143
  stays UNAVAILABLE. Parser and completeness rules are not relaxed.

## Validation

```sh
bun test scripts/ios-native/rerollObservation.test.ts
REROLL_BASELINE=1 bun test scripts/ios-native/rerollObservation.test.ts
bun test packages/game-engine/tests/nativeInputTrace.test.ts packages/game-engine/tests/nativePersistence.test.ts
node --test scripts/ios-native/inputLog.test.mjs
```

The lifecycle harness runs the real Play, Action, LocalProvider and store with controlled storage.
Only the native host and storage are substituted. It compares bytes, publications and results
across the pinned f558 Play, the current Play and a shipping build. With `REROLL_BASELINE=1`, its
first test runs the pinned Play, reaches the one durable move, then fails only because Re-roll
records are missing. All tests keep the unchanged 5000 ms and 30000 ms bounds.

The baseline is `scripts/ios-native/fixtures/reroll-baseline-f558.tsx.fixture`, from commit
f558f62f706dca8035eb2c4d9d32a7438f4666b2. It is verified before bundling, with CRLF normalized to
LF, against SHA-256 866b4e8c8674f9ea93adc520ee960017c679546021af8b1cde268f801106e778. No Git history
is read.

## Limits

These are browser component controls, not native proof. Host callback delivery isolates JS
decisions; it does not prove UIKit delivery. No native run was made for this change. Positive
native Re-roll phases, localization of any failed tap and one-tap state advancement on the native
matrix stay pending ordinary hosted qualification. Issues 102, 112, 115 and 41 stay open. No retry,
wait, keyboard or guard change is introduced.
