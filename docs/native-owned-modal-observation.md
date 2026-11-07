# Owned reset alert observation

Refs [issue 41](https://github.com/hemsoft-dev/yahtzee/issues/41). The existing damaged-storage and explicit-reset contract applies. Open and closed issue bodies and comments were checked before this allocation; no duplicate issue was created. Issues 41, 102, 112 and 115 remain open.

## Evidence and ownership

At PR122 source c35fb582, all three tablet10 gameplay scenarios passed. The later corruption/reset interaction failed because the native confirmation remained visible after the original single Delete tap. This is distinct from the historical cancelled Fours score. Neither failure establishes a reset, scoring, persistence or gesture-policy defect.

Pinned React Native 0.86.3 `RCTAlertController` creates a separate `UIWindow` with a plain `UIViewController` root. That window is outside the score observer's RN surface. Its original `show:completion:` makes the window visible and presents the alert; `hide` hides and detaches it. The build checks the exact source hashes of that controller and `RCTAlertManager` before injection. These source contracts do not attest the loaded precompiled RN image.

The qualification simulator app links `NativeModalObserver.mm` alongside the existing score observer. The signed/archive build, dependencies, pods, workflows, JS tracing, store, scoring, reset policy and held PR114 files are unchanged. No prebuilt RN core or installed source file is rewritten.

## Restricted native hooks

The entire three-method set must belong to `RCTAlertController` and pass ABI preflight before any replacement: the `alertWindow` getter, `show:completion:` and `hide`. Wrappers call the original once and preserve its return, BOOL, nullable completion object and exceptions. The completion is forwarded unchanged and is not wrapped or called by the observer.

Only the existing reset confirmation is eligible: fixed title, exactly the fixed Cancel and destructive Delete actions, and no text fields. No supplied text is written. Its original getter must return exactly a `UIWindow` with a plain `UIViewController` root. The observer changes only that instance's class to a no-ivar subclass of `UIWindow` after checking allocation size, superclass and exact `sendEvent:` type encoding. The override calls `super` once and preserves exceptions. It records only touches whose `window` is that owned instance. Other windows, subclasses and unsupported runtime shapes are left untouched and reported unavailable. No UIKit class implementation, OS-wide hook, recognizer policy or action handler is replaced.

The hosted build first compiles and runs a Foundation forwarding control covering instance isolation, incompatible layouts, exact dispatch argument/exception identity, getter identity and BOOL/completion forwarding. This control is not a UIKit runtime test. Actual window adoption, UIKit forwarding and native samples require the new source's ordinary hosted execution. Runtime shape failure must not cause an alternative hook or retry.

## Positive boundaries and unavailable callbacks

The numeric event vocabulary is installation, show entry/return/throw, owned-window adoption or unavailable, dispatch entry/return/throw, hide entry/return/throw, and budget reached. Each process has a module-load monotonic epoch; alert, window, dispatch and touch IDs are finite and scoped by that process and epoch. Only known button-trait/control ancestors with the fixed Delete or Cancel label receive a target enum. Unknown targets stay zero.

`RCTAlertManager`'s `alertWithArgs:callback:` takes a C++ reference to generated arguments. This tranche does not substitute an object ABI for that reference or hook the callback. `directCallback` is always `unavailable-cxx-reference-abi`. A returned window dispatch, presentation call or hide call is not a confirmation callback, JS handler, persistence acknowledgment, dismissal completion, paint or accessibility proof. The pinned manager's call order cannot substitute for a captured callback. No manufactured completion or reset acknowledgment is emitted.

Dispatch samples contain only numeric native touch timestamp, wall/monotonic brackets, current window and screen coordinates, matched target bounds, orientation and scale. The parser reuses the conditional native-touch clock calculation. It rejects stale/impossible samples; stable clocks are an assumption, not JS/video calibration. Recognizer kind, state, relationship and cancels-touches flags are candidate snapshots only. Native cancellation owner and reason remain UNKNOWN without causal evidence.

Limits are 2048 observations plus a budget marker, 128 alert/window/touch IDs, 16 live touches, four touches per dispatch and eight candidate recognizers. Runtime data excludes text, identifiers, addresses, class names, stacks, error payloads, routes and environment. The native writer is asynchronous and advisory.

## Retention before cleanup

The existing gameplay retention also freezes typed modal prefixes. Every corruption reset interaction now freezes its owned modal and score observer prefixes in a `finally` boundary after the original interaction closes and before device cleanup. A tested wrapper preserves the original result or exact thrown error even if retention fails. The original reset actions, retry protocol, assertions and deadlines are unchanged.

The capability helper requires `scopeWindowOverlapObserved === true` before
using a retained prefix for its enclosing corruption route. False or absent
overlap stays unavailable. A c124 database receipt also retained a complete
earlier document-alert prefix whose overlap was explicitly false. The previous
helper counted that older prefix under the database scope. Current-scope
document and database prefixes independently contained genuine positive records;
the correction rejects the extra attribution rather than explaining the other
failed jobs. This file-level overlap is conditional clock evidence, not proof
that every event in a mixed-age prefix belongs to the route or that a callback
ran. Per-window records and all other provenance limits remain necessary.

For the first authored damaged-document fixture, a bounded read-only SQL expression returns only whether the single expected key still equals the exact `damaged-save` marker. Only a positive match permits freezing those twelve known synthetic bytes, with hash and size. Other values, missing data or read failures stay unavailable; arbitrary damaged content is never copied. This proves the exact value match at that read, not a database snapshot. The existing physical-corruption preservation remains unchanged.

The reader accepts only fixed process/epoch filenames inside the owned app Documents directory. At most 64 matching entries are considered; the newest eight by modification time are selected, up to 4 MiB each. This keeps accumulated relaunch headers from suppressing the later corruption prefix. Omitted files are counted, and modification-time selection is not causal ordering. It rejects links/nonregular files, verifies open-file identity and filename/process agreement, freezes only validated finite records, and refuses overwrites. A failed later file preserves earlier receipts. A sequential file read is not a stopped-writer snapshot. All retention stays partial, absent events prove nothing, and a post-interaction prefix cannot establish native behavior outside its retained window.

## Validation limits

Local Node filesystem, parser, privacy, cross-window and error-preservation controls are portable fixtures. They are not native proof. New source must compile under the actual hosted toolchain, pass both Foundation controls, install all expected owned methods and produce source/run/build/process/window-bound records in ordinary qualification before any capability claim. An unsupported UIKit shape may leave the exact question unavailable. No historical touch is replayed and no unchanged run is retried for green.
