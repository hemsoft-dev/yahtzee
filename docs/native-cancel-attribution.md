# Qualification-only native cancellation attribution

Refs [#102](https://github.com/hemsoft-dev/yahtzee/issues/102), [#112](https://github.com/hemsoft-dev/yahtzee/issues/112), [#115](https://github.com/hemsoft-dev/yahtzee/issues/115) and [#41](https://github.com/hemsoft-dev/yahtzee/issues/41). This is observation, not an input-loss fix or reset acceptance.

## Retained occurrence

[PR121 source c789251](https://github.com/hemsoft-dev/yahtzee/pull/121) ordinary [tablet10 job127816157483](https://github.com/hemsoft-dev/yahtzee/actions/runs/42192892631/job/127816157483) failed a single Fours score assertion. The driver returned from the center tap normally, then continued AX queries. JS press-in67, out68 and correlated native-touch-cancel69/id67 span219.606ms. The save retains Ones/Twos/Threes and no Fours. Health143 remains UNAVAILABLE. The video has a28.298333s frame gap over the nominal touch, without calibrated wall/PTS correspondence. Cancellation owner and reason remain UNKNOWN.

The separate [nine-stage UIKit probe](https://github.com/hemsoft-dev/yahtzee/actions/runs/42192892638) passed on that source. This demonstrates capability only, not historical reproduction or observer exoneration. Its source, media and receipts stay separate and unchanged.

## Why observe below JS

Pinned React Native0.86.3 `React/Fabric/RCTSurfaceTouchHandler.mm` emits the same TouchCancel from `touchesCancelled:withEvent:` and from `reset` when active touches remain. Its simultaneous-recognizer delegate can call `_cancelTouches`, which toggles enabled off/on, after an external recognizer can prevent the surface handler and cancels touches. `RCTEnhancedScrollView` delegates `touchesShouldCancelInContentView:` to its RN overriding delegate. A YES is permission, not proof that scrolling caused a cancellation.

The locked pods use `React-Core-prebuilt`; editing an installed RN source file would not instrument that binary. Instead the simulator-only build adds one Objective-C++ observer to the **generated** app target, with no RN source rebuild, Pod/lock change, archive injection, app/JS/store/gesture policy edit, timer, retry or changed input. The new source is under `scripts/ios-native/native-cancel`. `TARGET_OS_SIMULATOR` is enforced at compile time.

Installed dependency version and two native source hashes must match the recorded0.86.3 contract. The hashes describe the published source, not attestation of a precompiled RN image. At runtime, all nine methods must be declared on the named RN classes with the expected argument and return encodings before any method is replaced. An inherited UIKit method is never modified. Missing classes/signatures produce a finite installation failure, not a guessed fallback.

Each wrapper forwards original self/selector/arguments once and preserves its return or thrown exception. Observation catches its own errors. It records method entry, not UIKit's private internal arbitration. There is no OS-wide UIWindow or UIGestureRecognizer swizzle. A separate macOS Foundation control, compiled and run before app injection, exercises the shared runtime installer with real Objective-C methods: invalid preflight leaves all implementations intact; valid forwarding preserves counts, both BOOL results, argument identity and thrown exception identity; double installation is refused. Local JavaScript fixtures do not run that native control.

## Finite native records

One private `Documents/native-cancel-<pid>.jsonl` file per process, opened exclusively without overwriting. Serialization/writes run on one serial queue; no timer or synchronous event-path I/O is added. Up to2048 observations plus one budget marker,16 tracked touches,8 move observations per touch and8 recognizer candidates per record. End/cancel records still sample current coordinates after the move cap. No labels, class names, native identifiers, addresses, event objects, stack traces, error text or environment is retained.

- Kinds0..11: installation, touch begin/move/end, UIKit cancel entry, recognizer reset, RN `_cancelTouches` request, simultaneous delegate entry/exit, scroll cancellation permission, detach, budget marker.
- Origin0..4: unknown, direct UIKit entry, reset entry, current external-recognizer delegate call, detach call. A numeric call-context ID is restored after nested calls. A numeric touch ID is process-local and stays separate from JS scoreId.
- Target0..6: other/unknown, or the six fixed number-score controls. Ancestry lookup is bounded; unknown is never converted into a target guess.
- Peer/candidate snapshots contain only finite recognizer kind/state, cancelsTouchesInView, relative view ancestry and whether it is its UIScrollView's own pan recognizer. A candidate snapshot alone is never attribution.

`nativeCancelSummary` calls the route `rn-external-cancel-call` only after an observed simultaneous delegate entry and actual `_cancelTouches` request precede cancel/reset in the same native context and touch ID. It reports direct UIKit cancellation or reset with unknown ownership separately. It suppresses post-end resets as cancellation outcomes. This locates an RN call path; it cannot name a private UIKit reason beyond that path. JS cancellation and a successful/failed score must still be correlated from their own existing trace, driver and save evidence.

## Clock and coordinates

Each native touch observation samples monotonic uptime before/after the wall-clock read and retains UITouch.timestamp separately. A sample span over one second, stale/future touch timestamp or missing values makes the derived interval unavailable. Otherwise the conditional wall interval is `wall + touchTimestamp - [uptimeAfter, uptimeBefore]`. This interval is bounded by the observed sample span **conditional on no intervening wall-clock step**. It is not a calibrated JS or video clock. Existing JS wall/monotonic observations and original driver request timestamps remain independent sources; no timestamp equality or global clock offset is presumed.

Coordinates, previous position, current target frame, window dimensions and scale are integer millipoints sampled at the native method entry. Screen-space coordinates and orientation are separate from window-space values. Positive point-in-current-frame uses only that same record and a nonzero frame. This avoids backdating the earlier probe's zero-sized first-layout geometry. It is not screenshot, paint or finger-motion proof. Apple documents [UITouch](https://developer.apple.com/documentation/uikit/uitouch) and the [Objective-C runtime method replacement boundary](https://developer.apple.com/documentation/objectivec/method_setimplementation(_:_:)?language=objc).

## Retention and limits

After the existing scenario, or its original failure, a bounded metadata command resolves only the owned simulator app container. The reader accepts at most8 fixed-prefix regular files,4MiB each, with no-follow/nonblocking open and opened-file identity check. It freezes a typed numeric prefix into the existing evidence inventory. Invalid raw lines are discarded and counted, never copied. Read-before/read-after clock samples and conditional scenario overlap are retained per process. Old process epochs are never merged into one cancellation.

Every receipt is partial: the asynchronous writer is not attested closed and later writes may be absent. Sequence gaps, partial lines, budget markers, malformed data, links, unavailable files or installation failure remain explicit. No absence proves an absent touch/handler/cancellation. The existing JS trace schemas, shared8192 bound and143 health rules remain unchanged; these native observations do not decide a flow's result or weaken any assertion. Runtime instrumentation can affect timing, so neither positive nor negative results exonerate the observer or establish a pressure cause.

Local tests cover parser/privacy, bounds, call-context classification, immutable owned-file retention and build-admission logic. **Objective-C++ compilation, actual runtime forwarding control, generated-project injection, runtime installation and native attribution are unvalidated until this new source's ordinary hosted qualification.** No original touch is replayed, no unchanged run is retried, and PR114's held files are untouched. All linked issues remain open.
