# Isolated comparison working-state capture

Refs [#41](https://github.com/hemsoft-dev/yahtzee/issues/41). Historical67e6ae04
is terminal12/15, with required modal/settle/aggregate failures. Its comparator
equivalence, synthetic benchmark and hosted build capability do not qualify the
complete pipeline or establish the remaining failure's cause.

## Representation and scope

The exact pinned ImageComparison4.4.0 source computes a binary0/1 matrix and
count before grouping regions. The diagnostic snapshots that existing matrix
before any grouping mutation, with its exact dimensions, count, counter2,
regionCount2, threshold5, minimum rectangle size1 and allowing-percent0. Other
configurations are unavailable rather than guessed. Exclusions and pixel
tolerance are already reflected in this matrix. No image, RGB sample, text,
label, URL, SQL, environment dump or arbitrary error value is retained.

This is sufficient to reproduce the changed region-grouping, rectangle-bound,
filter and merge work, not original decoding, color/raster conversion, drawing
or full-comparator behavior. Offline replay creates black/white surrogate
images and first verifies that the actual released matrix-population method
reconstructs every captured bit and the exact count. It then compares ordered
rectangles, final labeled matrices and counter/region state from actual release,
unmodified rebuild, current candidate and an offline-only profiled candidate.
No full-comparator equivalence or original pixel-conversion cost is inferred.

Only the existing observed CLI's authored isolated synthetic corruption route
enables capture. `run.mjs` sets a fixed document/database route identity only at
those existing reset sessions; ordinary gameplay and the other ordinary jobs
remain disabled. The existing stage6 synchronous context supplies its numeric
call/parent IDs. Source/run/attempt/route/PID and hashes bind the retained data.
No extra app/screenshot/AX request/input, retry, thread, timer or sampler exists.

## Explicit limits

- At most one first computed matrix per route, two routes, including zero
  differences so an actual early return is not omitted. Readiness recovery
  occurs before authored comparison calls; it does not replay the fixture.
- Maximum8192 rows/columns and8,000,000 total cells. Packing is one bit/cell,
  at most1,000,000 bytes per matrix, with no original matrix reference queued.
  Added pending payload is at most1MiB per active comparison process.
- A200ms cooperative copy budget is checked per row and after copying. Oversize,
  unsupported config, malformed/changed/count-inconsistent or expired input
  leaves unavailable status. Snapshot failures cannot replace original results
  or thrown objects. The original call never waits for disk or writer drain.
- Output uses the **existing** daemon writer/queue with500ms cooperative checks,
  at most8192 bytes per write and no retry. Ordinary kernel write/close may
  block beyond that budget; no hard I/O deadline is claimed or invented. That
  cannot hold the original call. Missing/truncated output remains unavailable.
- One fixed first-attempt status and one attempted-matrix status are bounded
  to2048 bytes each. `seenAtCopy` is prefix-only; subsequent omission counts
  remain unknown. Queue drops and process exit can lose suffixes. Published
  payload is below3MiB+16KiB: two matrices plus one exact comparator JAR
  (at most1MiB) and metadata. Live private inputs and immutable pre-cleanup
  copies add at most another4MiB+32KiB on disk; they are not uploaded by the
  native snapshot. The new working-state copies total at most7MiB+48KiB on disk.

Copying, hashing, queueing and I/O can perturb timing and existing telemetry.
Comparison stage6 includes synchronous capture overhead; never subtract it into
a supposed historical duration or call this route unmodified. Native jobs,
60s/30inspection/600ms, all waits/assertions/Cancel/Delete/removal/final saves,
archive and aggregate remain mandatory. Capture availability does not change
the original qualification oracle or waive a failed route.

## Validation and retention

Pinned source/hash transforms add only a guarded snapshot statement to the
already-patched comparator. Reversing both changes restores original source.
The existing build checks ABI, unrelated method bytecode and every other JAR
entry. Stage builds include the captured-state helper and forward-once controls;
control classes never enter the toolchain. Original-release missing-capture RED
reaches its real mask result and expected getter counts before failing solely
on absent capture. Instrumented controls check actual result/getter/error
identity and immutable pre-grouping bits, plus copy/memory/partial/throwing/blocked
sink behavior. No new writer is created.

Pre-cleanup retention reads only bounded regular private files, validates exact
keys, numeric identities/config, padding, count and SHA256, and writes immutable
hidden owned copies. After the original child exits, existing stage retention
revalidates them and links only a containing same-process stage6 pair. Missing
or ambiguous pairs preserve UNKNOWN correspondence; a complete matrix is not
an invented stage completion. Native evidence snapshot skips the hidden input
directories. Validated numeric binary state and the exact small comparator JAR
go into the existing owned stage artifact, without a public image attachment.

## Offline replay

Use `scripts/ios-native/comparison/replay.py --help` for explicit owned file
inputs. It verifies original package/source/candidate hashes, schema/count/bits,
and exact source/run/attempt. It requires a fresh output directory, retains all
command outputs/exits and runs CPU-only Java17 with capture disabled. No driver
or device is launched. A compile-only disabled bridge has a checked zero call
count; the original release and actual candidate bytes remain the oracles.

Each implementation makes one verification call, two warmups and four timed
`createMask` calls in balanced cyclic order (28 total), plus one extra released
binary-matrix check. Image construction and output verification are outside the
timed calls. CPU counter bookends include observation overhead and unsupported
values stay unavailable. The profiled candidate brackets original matrix
population, grouping, candidate bounds and merging; output/state equality is
checked against the plain candidate. Its phase totals include verification,
warmup and measured calls, not a hidden extra native workload. Local offline
execution has a512MiB heap and600s process ceiling; exhaustion/timeout is an
explicit limitation, never a changed native deadline or fabricated result.

The tiny owned capture fixture proves this path locally, not representative
performance. Actual hosted capture, independent provenance/correspondence
verification and same-state matched profiling remain gates. No additional
algorithm change is authorized or included. Causes UNKNOWN; issues41/102/112/115
open;143/partial/conditional clocks/C++callback/loadedimage/font/public404 and
prior historical limitations remain.

References: [Java17 FileChannel blocking semantics](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/nio/channels/FileChannel.html),
[BufferedImage color/raster semantics](https://docs.oracle.com/en/java/javase/17/docs/api/java.desktop/java/awt/image/BufferedImage.html).
