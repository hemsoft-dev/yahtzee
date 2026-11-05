# Done navigation observation

This qualification-only observation advances [#102](https://github.com/hemsoft-dev/yahtzee/issues/102)
and [#115](https://github.com/hemsoft-dev/yahtzee/issues/115). It adds evidence and changes no behavior.
No retry, wait, guard, delayed navigation or new UI is introduced, and no defect is claimed fixed.
Issues 41, 102, 112 and 115 stay open.

## The occurrence

Native [run41969726376](https://github.com/hemsoft-dev/yahtzee/actions/runs/41969726376), attempt 1,
failed `tablet8-ai-dark-wide` in FLOW1, before gameplay. The original Help tap passed its `How to play` assertion.
The original single Done tap at 958,1105 returned at 00:53:46.992292 EST on November 5, and
`assertNotVisible How to play` failed. The retained image still shows the dark Help modal with Done over Setup.
Driver hierarchy requests continued, and no screenshot timeout or test-server teardown is established.
The authored trace has no Help or Done probes. Its health is UNAVAILABLE after exit 143.
The cause is UNKNOWN. Nothing here attributes it to, or clears, the site, load, the framework or the observers.

## What each boundary shows

| Boundary | Records present | Records absent |
|---|---|---|
| 1. Press/handler boundary | `done-press-in`, `done-press-out`, observation end or actual `done-handler` | Missing handler stays UNKNOWN without independent window coverage |
| 2. Router-call/stack-event boundary | Actual call and returned/threw; route instance received `beforeRemove` | Missing removal stays UNKNOWN; a received removal is not proof of its caller |
| 3. Effect/committed-route-value boundary | Layout-effect cleanup and finite committed `useSegments` value | Neither absence nor root's initial default proves dismissal |

`status: "available"` means the collector passed its shutdown, parsing and sequence checks only.
It does not establish application emission, process identity or coverage of the entire original tap window.
Absent records stay UNKNOWN without independent epoch/window completeness evidence; this channel provides no heartbeat or terminal app marker.
Exit 143 stays unavailable, as it does on the input channel. A clean shutdown alone never proves an absent handler.
Retained records are parsed and remain positive evidence of what they name, whatever the status.
A record also says nothing about native paint, accessibility, gesture delivery or what the driver saw.

## What the seams mean

These come from reading `expo-router` 57.0.29, the version `bun.lock` pins, from its registry tarball
(SHA-256 `c152ee5a6d77d98f3cda62ecc94534d8bd621082312cd80a3a1fdbae302c186e`, matching the lock's integrity value).
It vendors React Navigation under `build/react-navigation`.

- `router.back()` only enqueues `GO_BACK` in `routingQueue`. A passive effect later dispatches it.
  So `done-router-back-returned` means enqueued at most, never navigated.
  `routingQueue.run` silently drops an action when its ref is null, which would leave no removal record.
- `beforeRemove` fires inside the navigator's `onAction`, after the router computed a removal and before `setState`.
  It proves some action computed this route removal, not which caller caused it or whether it committed. The listener never calls `preventDefault`.
- `done-route-effect-cleanup` is a layout-effect cleanup. StrictMode replay, Suspense hiding and real unmount all run it.
  A following `done-route-effect-reattach` records reattachment. Cleanup alone does not identify its cause or prove permanent unmount/dismissal; hiding may persist past capture.
- `done-route-branch-*` is `useSegments()` read in a root layout effect, so it is a committed React value with no request ID.
  `root` also covers the store's default before navigation is ready.
- `transitionStart` and `transitionEnd` are emitted by the vendored native stack from `react-native-screens` callbacks.
  A JS-initiated removal takes the route out of the rendered list, so the closing pair may never reach this route.
  Their absence is not evidence.
- `blur` does not reach a route being removed: the real core harness shows its listener is disposed first.
  `blur` is recorded for the case where Help loses focus and stays mounted.

## Correlation

`doneId` is the first activation record's sequence. `routeId` is the attach record's sequence for one route instance.
Press-out is independent and may come before the handler or after unmount. An unmatched handler gets its own ID
with no invented press. Removal gets a `doneId` only when it is `GO_BACK` and exactly one call is open.
This is a candidate association, not causal attribution: another GO_BACK can race the single open Done call.
Two open calls, a `POP` from a native dismissal, a thrown call or a call made after the removal all leave it absent.
Focus returning ends the removal, so later records cannot borrow it.

## Bounds and privacy

This is a separate channel with its own marker, `THIRD_ROLL_DONE `, so the input collector and its 8192-record cap,
schemas and health never see it. The app writes at most 1024 records per process and has no heartbeat.
`scripts/ios-native/doneLog.mjs` retains at most 1024 records and 256 KiB per scenario, and rejects lines over 16384 bytes.
Route keys, names, action types, native event times and errors are read in memory only.
Records hold finite phases, numeric IDs and the two clocks.

Sequence restarts at 0 in each process. The collector counts restarts as `segment`, which is not a native process identity.
Do not correlate timestamps across segments. The input and Done channels have separate sequence numbers.
Any missed sequence makes the receipt unavailable, including one consumed by a failed sink or clock.

`scripts/ios-native/run.mjs` starts this stream after the input observer and stops it after that observer.
It writes `done-events.jsonl` to the scenario folder and `doneTrace` to the scenario's receipt.
Its advisory wrapper does not throw or reject and bounds its own shutdown wait to 3 seconds; it does not turn retention status into an exercise failure or replace an original error.
The extra wait/process still has overhead, and no claim is made that observation cannot affect timing near an outer deadline.
The extra read-only `log stream` is one more process on the runner, and that load is not measured.

## Running the tests

```sh
node --test scripts/ios-native/doneLog.test.mjs scripts/ios-native/doneObservation.test.mjs
bun test packages/game-engine/tests/nativeDoneTrace.test.ts
bun test scripts/ios-native/doneObservation.test.ts
DONE_BASELINE=1 bun test scripts/ios-native/doneObservation.test.ts
```

The last command must fail, and only on the first test. That test runs the pinned route from
`scripts/ios-native/fixtures/done-baseline-136.tsx.fixture` (from `1362293de2bacf4ea82930b42a6d7b4d4fb08e36`, LF, verified by SHA-256).
It reaches the original `router.back` and finishes navigating, then fails on the missing Done records.

The lifecycle harness runs the real `app/help.tsx` and `app/_layout.tsx` with the real `Action`, `Help`, `LocalProvider` and store,
on the vendored navigation core, `StackRouter` and `routingQueue` from the installed `expo-router`.
The stack view, press host, `useSegments` and storage are browser fixtures. It proves JS and React seams only, not native behavior.
