# Qualification comparator source patch

Refs [#41](https://github.com/hemsoft-dev/yahtzee/issues/41). This changes the
qualification toolchain, not app behavior. CLIs built by this route are
**source-patched**, including the ordinary native matrix, owned-modal route and
observed settle route. The AX-request job does not use this Java comparator.
Every existing job, required aggregate, original action, wait, assertion,
60-second/30-inspection guard and 600 ms gesture remains required.

## Evidence and algorithm

On historical head `70807091fbad9fe34dda416f652fa15e3217112f`, the observed
copy's comparison stage took 16.621 seconds elapsed and 11.364 seconds of
current-thread CPU. This supports studying that copy's computation. It does
not attribute original-package failures or establish a historical cause.

The pinned `image-comparison-4.4.0.jar` has SHA256
`b3331881bafd1d539e728e4670301931d019a23a2eabf257370a06075cb16c83`.
Its original `populateRectangles` scans the whole labeled pixel matrix once
per region, including its final empty region. With P pixels and R regions,
rectangle construction costs O(P*R). Grouping, merging and drawing have their
own unchanged costs.

The patch aggregates all region bounds in one matrix pass, using temporary
per-call rectangles in original counter order. It retains the exact original
pixel predicate and count, matrix population, recursive grouping, rectangle
update function, filtering, counters, merge order, drawing, output destination
and difference calculation. There is no cross-call cache, conversion,
downsampling, tolerance change or skipped comparison. It costs O(P+R) for this
part and adds O(R) temporary references. VM resource-exhaustion behavior and
concurrent mutation are not claimed equivalent by finite tests.

## CPU-only controls and measurements

Actual original release classes are the golden oracle. An unmodified source
rebuild is a separate source/compiler control. The candidate is checked against
both, not merely against another implementation of the expected arithmetic.
The build runs 638 differential cases and repeats 569 against the packaged JAR.
They compare float bits, threshold decisions, state, ordered rectangle bounds,
result-image pixels/type/identity, input mutation and destination output.
Cases cover all 13 standard BufferedImage forms, mixed types, alpha and
premultiplication, subimages/strides, custom byte/ushort/float/double rasters,
dimensions/nulls, original public options, repeated calls, exclusions, and
original getter order and thrown-object identity.

Java's helpful null-error messages depend on debug variable metadata and its
fast-throw optimization. Controls compile with `-g` and disable fast-throw
message omission in their private JVM only. No such option is added to the
installed CLI or native requests. Original and rebuilt classes must agree too.

Linux Java 17.0.17 controlled measurements used synthetic owned images, eight
warmup comparisons and eight alternating matched trials per fixture, repeated
in two JVM processes. Timed regions include constructor and comparison only;
verification hashing occurs outside them. Median times below are milliseconds.

| Fixture | Original CPU, runs 1 / 2 | Candidate CPU, runs 1 / 2 | Original elapsed, runs 1 / 2 | Candidate elapsed, runs 1 / 2 |
| --- | --- | --- | --- | --- |
| Equal | 64.130 / 65.922 | 65.543 / 66.316 | 70.657 / 72.389 | 70.531 / 70.898 |
| One 2x2 region | 120.113 / 119.555 | 117.102 / 117.114 | 125.740 / 128.162 | 126.221 / 123.233 |
| 336 separate 2x2 regions | 829.019 / 837.538 | 119.753 / 122.670 | 844.905 / 858.171 | 126.614 / 129.071 |
| Mixed raster types | 826.427 / 832.303 | 101.219 / 104.260 | 846.185 / 851.528 | 107.856 / 110.543 |
| Subimages | 815.253 / 837.952 | 122.582 / 123.322 | 835.617 / 856.335 | 129.214 / 129.745 |
| Premultiplied alpha | 797.222 / 788.075 | 85.216 / 85.080 | 815.142 / 806.486 | 90.749 / 90.202 |

This is a repeatable improvement for separated-region fixtures, not a universal
speedup or native latency forecast. Equal/single-region cases show little change.
An earlier verifier-inclusive timing run is retained but is not this table.
One second-process harness attempt failed because its output directory already
existed; it produced no second benchmark. The corrected run used a fresh owned
directory without deleting or replacing that evidence.

## Build and provenance gates

`scripts/ios-native/comparison/build.py` verifies the binary JAR and exact Maven
source archive/content hashes before transformation. Java/javac 17 compiles the
original and candidate with the same options. Reversing the sole pinned source
replacement must restore the original bytes. Public ABI must be exact; resolved
bytecode outside `populateRectangles` must match the unmodified source rebuild.
Only `ImageComparison.class` enters the output JAR; every other JAR entry and
CLI file is verified unchanged. Fixture classes never enter the CLI.

The original JAR, source archive, generated source, controls and their exits
remain in the owned build's private directory. The finite `proof.json` records
source/run/attempt, original and patched hashes, checks and availability, and is
retained even when building fails. The original release archive is not modified.
The workflow's original package hash verification remains in place. The settle
copy receives this separate dependency patch after its original observation
build, preserving that build's client/CLI/native hashes.

Proof identifies staged bytes; it is not OS loaded-image attestation. A local
benchmark or fixture pass cannot waive native/modal/AX/settle/archive/aggregate
failure. macOS compilation and complete source-bound native qualification remain
hosted gates. Historical reset/activation causes stay UNKNOWN, and issues
41/102/112/115 remain open. Exit 143, retained-prefix, conditional-clock,
C++ callback, requested-font, loaded-image and public-PNG404 limits remain.

Primary references:

- [Pinned comparator sources](https://repo.maven.apache.org/maven2/com/github/romankh3/image-comparison/4.4.0/image-comparison-4.4.0-sources.jar)
- [Java 17 BufferedImage and color conversion](https://docs.oracle.com/en/java/javase/17/docs/api/java.desktop/java/awt/image/BufferedImage.html)
- [Java 17 thread CPU counters](https://docs.oracle.com/en/java/javase/17/docs/api/java.management/java/lang/management/ThreadMXBean.html)
