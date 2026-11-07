# Reset search settle observation

Refs [#41](https://github.com/hemsoft-dev/yahtzee/issues/41) and
[#102](https://github.com/hemsoft-dev/yahtzee/issues/102). This qualification copy adds observation and fixes nothing.
The original native matrix, owned-modal job, app, reset search, assertions,
60-second search budget, 30-inspection bound and gestures remain unchanged.
The separate stage job is also required by the aggregate.

## Retained occurrence

On PR122 head `c4391df2c33b2f3cea912db1695e0f2065f29a0c`, the isolated
largest-profile document reset completed. The database reset performed six
returned down swipes in viewport `[0,106][1032,1356]`. Its first five decision
records had no target. The sixth placed the target at `[176,1362][856,1444]`.
Only that final full AX snapshot survives. Earlier snapshots were overwritten
by the existing `reset-screen-latest.json` retention policy. They cannot be
reconstructed from the decision records.

There is no recorded direction reversal. Target movement, stall or oscillation
cannot be quantified from absent target coordinates. The final snapshot's
ancestor geometry supports the below-viewport decision. No geometry defect was
established. The sixth swipe returned before the budget expired. The following
animation wait returned after the budget, and the guard stopped before another
AX query or confirmation tap. The 66-byte synthetic corrupted database was
preserved. Later pixels are not the missing AX observation.

Recorded explicit waits totalled about 30.123 seconds, swipes 27.180 seconds,
and inspections 2.465 seconds. These are outer RPC measurements, not an
attribution of time inside the driver. An offline execution of the unchanged
helper with those offsets and constructed decision geometry reproduces its
budget guard. It is not a native replay or exact original monotonic-clock proof.

## Exact source and build

The CLI source is fixed at
`14a408335e17a090df1e26bdbeaf80d8122a8fd8`. `stage.py` requires the SHA256
of `maestro-client/src/main/java/maestro/Maestro.kt` and replaces exactly two
call expressions. It also verifies `maestro-client/src/main/java/maestro/drivers/IOSDriver.kt`
against SHA256 `bb93fd4eb42e07b6b7d4bf6921dfeebf4b89f218cd1792d16d94153cf1ef47e9`
and wraps its original `runDeviceCall` expressions for screenshot and static-screen
completion. It also verifies `maestro-client/src/main/java/maestro/utils/ScreenshotUtils.kt`
against SHA256 `5f9381fa52134a6ed08c6e45db2c58e1fcfdf936a24d7a640cd300a653a1d22e`.
Its original `ImageIO.read` and complete `ImageComparison` expression receive
separate scoped timing. The capture and stream argument are evaluated before
entering the decode span, once and in their original order. Reversing the two
expressions in each of the three files restores its original bytes.
The surrounding original `runInterruptible`, arguments, return expressions,
exceptions and deadline values remain in place.

The original CLI archive, client JAR, CLI JAR and native driver JAR are verified
before compiling. Kotlin 2.2.0 matches the pinned version catalog and its
compiler ZIP is hash-verified before opening. Compilation targets Java 17 and
runs on Java 17. Build tooling is private; no package or lock file changes.

The compiler re-emits the whole `Maestro`, `IOSDriver` and `ScreenshotUtils` class families. This is not a two-class
binary patch: explicit waiting uses a synthetic method inside `Maestro.class`.
A two-coroutine-class prototype did not observe that boundary and was rejected.
All original class-family members must remain present. The build compares the
public ABI of all three classes, including `ScreenshotUtils.Companion`, and
verifies every JAR member outside those families byte-for-byte.
Test fixture classes are excluded. The CLI JAR, launcher, other libraries and
packaged Swift runner remain original bytes. Their identity does not attest
which images the OS loaded.

Actual JVM controls use both the original release and the packaged observed
copy. They require one original implicit-settle call with identical arguments,
the original explicit wait and screenshot path, returned values and thrown
object identity. The actual unmodified `RunTool.runInline` is exercised with a
fixed wait flow and a fixture driver. The original package must fail specifically
on missing stages. Disabled, throwing-clock, throwing-sink, negative-clock,
bounded-output and stalled-sink controls must pass before the copy is admitted.
The real `IOSDriver` also runs against an `IOSDevice` fixture. Controls check
the original screenshot bytes, sink and compressed argument, one static-screen
call, true and false results, original thrown object identity, disabled and
throwing observers, scope removal after throws, and an unrelated thread. A
hybrid retaining the original `IOSDriver` must fail specifically on missing
inner stages. These fixtures are not an Apple runtime or native proof.
An additional hybrid retaining the original `ScreenshotUtils` must fail on
missing decode/comparison stages after reaching the real explicit wait.
Stream controls compare image pixels, reads, closes, null results and thrown
object identity against the actual Java 17 `ImageIO.read`. Cache configuration,
stream ownership, image arguments, comparison threshold and retry logic stay
unchanged. The timing cannot establish cache, disk or scheduling causation.

## Finite stages

The qualification copy emits only numeric records with keys
`v`, `seq`, `id`, `parentId`, `stage`, `phase`, `monoNs`, `pid`, `wallMs`.
Version 2 adds `parentId` and the two device-call stages. Version 3 adds decode
and comparison stages with the same finite keys. Historical versions remain
parseable, but different versions never share a parent.

| Stage | Original observed extent |
| --- | --- |
| 1 | `ScreenshotUtils.waitUntilScreenIsStatic` inside the explicit wait |
| 2 | `driver.waitForAppToSettle` inside the existing implicit-settle wrapper |
| 3 | Original `IOSDriver` screenshot device call, only inside stage 1 |
| 4 | Original `IOSDriver` static-screen device call, only inside stage 2 |
| 5 | Original `ImageIO.read` call, only inside stage 1 |
| 6 | Original `ImageComparison` construction, comparison and difference-percent expression, only inside stage 1 |

Phase 0 is entry, 1 return and 2 throw. Throw classification is unknown; no
error text or payload is recorded. A returned wait is not an assertion pass.
Stages 3 and 4 time the existing synchronous device-call extent, including its
existing error conversion. They do not expose Swift screenshot acquisition,
HTTP wire timing, AX internals or an OS reason. Stages 5 and 6 time the original
decode and comparison extents separately. Remaining outer time is not assigned
to a particular cause; gaps cannot identify retry scheduling or host pressure.
Stage 3 intentionally omits screenshots outside the explicit wait, including
any fallback screenshot inside implicit settling.

An ordinary `ThreadLocal` scopes an inner call to the active outer call on the
same thread. Its numeric parent is restored or removed in `finally`. A device
call on another thread or outside the matching outer stage emits nothing and
consumes no ID. No context is propagated to asynchronous work. Parent links
are source scopes, not cancellation-owner attribution. Collection reports a
link only when the matching version/process parent pair contains the child's
sequence and monotonic interval. A missing parent remains unknown.

IDs are bounded to 128 and records to 256 per JVM. The original call only
offers a bounded event to a private queue. A daemon writer performs stderr I/O;
a blocked or throwing sink does not hold the original operation. No original
path waits for the writer, retries a call, or adds a shutdown wait or timer.
Its suffix may be lost at process exit, and collection always describes a
retained prefix. Control-only drain waits belong to the JVM fixture, not the
original CLI paths.
Inner records share the same cap, so a longer trace can reach it sooner.

Existing interaction logging captures stderr and original RPC timings. Only
the original one-command 5000ms wait and 600ms swipe flows are classified for
correspondence. A stage pair is associated with a request only if one matching
request contains its wall-time samples and duration. Ambiguous, contradictory
or missing correspondence stays unknown. Monotonic duration is within one JVM;
wall alignment is conditional and never compared directly to video PTS.

The parser rejects unknown keys, stages, oversized data and invalid numbers.
No YAML, coordinates, labels, AX values, URLs, SQL, environment, error strings
or user content enter the new finite receipt. PID is self-reported, not image
attestation. Gaps and truncation cannot establish absence.

## Hosted result

`Original reset settle stage qualification` builds a private copy, then runs
the existing `--modal-only` route once with its PATH scoped to that copy.
The unmodified original matrix and modal job run independently. No historical
input or unchanged run is replayed. A stage pass cannot waive either original
job's failure.

The new job retains `ios-native-settle-stages-<head>` and the separately bound
`ios-native-settle-route-<head>`. The finite receipt includes staging identity,
source/run/build references, original route exit and conditional stage pairs.
Missing or failed staging leaves a failed finite build receipt. Missing native
records remain unavailable. The original route must pass and each corruption
route must have positive matched explicit-wait and implicit-settle records
before the additional diagnostic gate passes.

No current hosted result is claimed by this document. Historical causes remain
unknown. Health exit 143 remains unavailable; native/modal partial coverage,
direct C++ callback, conditional clocks, loaded-image, public-404 and prior
incident limits remain unchanged. Issues [#41](https://github.com/hemsoft-dev/yahtzee/issues/41),
[#102](https://github.com/hemsoft-dev/yahtzee/issues/102),
[#112](https://github.com/hemsoft-dev/yahtzee/issues/112) and
[#115](https://github.com/hemsoft-dev/yahtzee/issues/115) remain open.

Primary references:

- [Pinned Maestro source](https://github.com/mobile-dev-inc/Maestro/blob/14a408335e17a090df1e26bdbeaf80d8122a8fd8/maestro-client/src/main/java/maestro/Maestro.kt)
- [Pinned iOS driver source](https://github.com/mobile-dev-inc/Maestro/blob/14a408335e17a090df1e26bdbeaf80d8122a8fd8/maestro-client/src/main/java/maestro/drivers/IOSDriver.kt)
- [Pinned screenshot utility](https://github.com/mobile-dev-inc/Maestro/blob/14a408335e17a090df1e26bdbeaf80d8122a8fd8/maestro-client/src/main/java/maestro/utils/ScreenshotUtils.kt)
- [Java 17 image decoding](https://docs.oracle.com/en/java/javase/17/docs/api/java.desktop/javax/imageio/ImageIO.html)
- [Java 17 thread-local scope](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/ThreadLocal.html)
- [Explicit animation wait](https://docs.maestro.dev/reference/commands-available/waitforanimationtoend)
- [Swipe and best-effort settling](https://docs.maestro.dev/reference/commands-available/swipe)
- [Kotlin compiler options](https://kotlinlang.org/docs/compiler-reference.html)
