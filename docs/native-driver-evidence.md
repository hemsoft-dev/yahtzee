# Native driver evidence

This qualification-harness capture advances the missing driver-identity and
early-control evidence in [#102](https://github.com/hemsoft-dev/yahtzee/issues/102).
It does not fix screenshot or input loss. The cause remains UNKNOWN.

## Owned paths and lifetime

Each interaction creates a fresh private hidden state directory beneath its
existing phase state root. Each readiness connection gets a separate private
JVM scratch child. Only the fixed MAESTRO_OPTS property
`-Djava.io.tmpdir=<owned scratch>` is supplied. Inherited JAVA_OPTS and
MAESTRO_OPTS are excluded. The option is single-quoted for the pinned launcher's
xargs parser, with apostrophes escaped outside the quotes. Controls including
newlines are unsupported. If ownership cannot be established, identity is
explicitly unavailable and the original interaction proceeds without this option.
TMPDIR is not used as a substitute for java.io.tmpdir.

The existing snapshot skips hidden trees, so raw JARs, runner products, results
and other JVM temporary files are not uploaded. No old allocation is adopted or
cleaned. Only this child's PATH-resolved launcher and two known adjacent JARs
are inspected outside the scratch root. Runner, test-plan and result discovery
stays within the explicit scratch root. Symlink/reparse escapes and references
outside that root are rejected. No shared temp, process or simulator scan occurs.

Capture runs immediately before the existing close, including a readiness retry
close. It adds no driver calls, flows, taps or restart. A separate worker performs
static reads with a shared five-second advisory cap across readiness attempts,
also bounded by the original interaction deadline after reserving the existing
60-second transport shutdown allowance. Capture is skipped with a budget reason
when only shutdown time remains. The worker is terminated before close;
installed result-tool subprocesses use at most one second within
the same remaining cap and are killed/reaped on timeout. A failed capture or
artifact write cannot replace the original result or error. Existing readiness
retry eligibility and no-post-submission-replay handling are unchanged.

## What the JSON means

`expectedPackage` contains the previously verified CLI2.10.0 package/JAR/test
binary pins and supported packaged-source ref. These are expectations, separate
from `observed` file SHA256/size, Mach-O UUID/build commands and finite bundle
build metadata. The xctestrun's resolved host/test-bundle references bind those
files to an observed plan. Counts and a fixed selection enum describe the plan;
they do not claim a testcase actually ran. XML and binary plists are decoded
without executing downloaded code. Environment dictionaries and arbitrary
test names are not retained.

`loadedImage: unattested` is deliberate. A file hash or UUID, even with a matching
package pin, does not attest a loaded image, the bytes executed during an earlier
request, or memory. An internal automatic driver restart may have changed the
available files before this capture. Missing/deleted/unreadable/malformed data
and resource-limit exhaustion remain partial or unavailable.

Static discovery is capped at 4096 entries, depth12, 32 observed files,
128MiB per file, 256MiB total reads, 64KiB per plist, four plans and four result
bundles. Traversal and reads share the capture deadline. Output contains only
fixed roles/status/reason enums, numeric counts, hashes/UUIDs and constrained
build fields, never paths, device IDs, environment values, arbitrary errors,
save bytes or application data.

For an existing owned xcresult bundle, an installed macOS xcrun/xcresulttool
may read its legacy typed object metadata. The reader accepts only the fixed
test-failure-summary schema and finite issue kinds, emitting kind, unknown code
as null, and error severity. Messages, stacks, test names, locations and
attachments are discarded. Bundle discovery is bounded; the reader rejects
linked trees, more than256 entries/depth8/128MiB and output above64KiB.
Absent bundles, unsupported tools/schema and tool failures are explicit
unavailable reasons. No result-bundle flag, test selection or runner option
is introduced. Local fixtures do not prove that hosted Xcode produced a bundle
or that this optional API will be available there.

## Early and late XCTest context

At most eight known XCTest source logs are retained from the fresh interaction
state. Each retains at most512KiB of actual UTF8 text after redaction, including
the omission marker. Oversized logs keep up to128KiB of early context and the
remaining budget from the tail. Complete small logs are retained once.
Partial boundary lines, including a writer's unfinished last credential line,
are dropped. Redaction expansion can remove additional complete lines.

The companion coverage JSON records source size/read intervals, redaction
truncation and omitted bytes. Read intervals describe input coverage, not a
claim that every input byte survives redaction. The in-text middle marker and
`continuous: false` make the gap explicit. There is no continuous-capture claim
across omitted regions or detached-writer updates after the read.

## Proof and limits

The old retention regression fails specifically because the original control
line disappears. The new early/tail control passes within the unchanged total
budget. The old interaction also fails the owned-JVM-property control. New
controls exercise actual interaction success, original errors, readiness retry,
pre-close disappearance, delayed/throwing/stalled collection, write failure,
fresh-state exclusion, static file/plan identity, malformed/escaping data,
privacy and bounded installed-tool termination. The actual installed xargs
parser round-trips spaces, quotes, apostrophes, backslashes and shell
metacharacters as one literal property, without executing the CLI or JVM.

Historical [a0 run41822379653](https://github.com/hemsoft-dev/yahtzee/actions/runs/41822379653)
failed tablet8 before Start, during Help/screenshot handling. It remains a
failure. Its phone6 Start135/preference118+91 positive observations and media
remain bound to a0. Current-source native identity/context proof is pending
ordinary hosted CI. No local browser, device or native workload supplies it.

The unchanged external driver does not emit internal screenshot-stage1/2
timestamps. Those stages remain UNKNOWN. Capture health143 stays UNAVAILABLE;
missing records do not prove absent handlers. React commit is not native
paint/AX/navigation acknowledgment. Issues102/112/115/41 remain open.
