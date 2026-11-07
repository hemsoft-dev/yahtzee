# Archive install observation

The archive job executes one child, `bun install --frozen-lockfile --ignore-scripts --verbose`, using the pinned Bun1.4.2 and the original five-minute step limit. Verbosity is the sole install-argv addition. No `BUN_INSTALL_VERBOSE`, retry, cache/config/dependency/lock change or new sampler/timer is introduced. Original archive checks, Xcode path and application/native/modal/aggregate requirements stay mandatory.

## Source and scope

The historical019a8543 archive run42359898036 stopped after initial resolution waits and before any later stage was recorded. It has no established source/package/network/pressure cause. This new verbose execution changes output and timing and cannot explain that old run.

Bun reports revision744846f84, resolved to [744846f844374847c902b5e7fd59b4342a51ef99](https://github.com/oven-sh/bun/commit/744846f844374847c902b5e7fd59b4342a51ef99). The [isolated install source](https://github.com/oven-sh/bun/blob/744846f844374847c902b5e7fd59b4342a51ef99/src/install/isolated_install.rs#L850-L1164) selects timing output for `--verbose` and prints peer-resolution and store-construction markers. The [pending-task message](https://github.com/oven-sh/bun/blob/744846f844374847c902b5e7fd59b4342a51ef99/src/install/PackageManager/install_with_manager.rs#L1073-L1084) exposes only a count. [Official logging documentation](https://bun.com/docs/pm/cli/install#logging) documents the flag. No new Bun build or upstream modification is used.

## Finite records

`reports/archive-install-evidence/synopsis.jsonl` and the public terminal synopsis contain only fixed keys, numeric classes/counts, nullable monotonic read times, and validated workflow SHA/run/attempt identifiers. `workflowSha` is GitHub's workflow revision, which may be a PR merge revision; the checkout/source head is established separately by the job log and head-named artifact. It is not loaded-binary attestation.

Pinned duration tokens include ordered compound forms such as `1m5.2s`, `2m400ms` and `1h2m`, including the formatter's `us` spelling. The classifier validates the bounded duration and discards it. This also covers a phase that completes after a minute within the original five-minute gate.

Marker stages:

| Stage | Marker meaning |
| --- | --- |
| 1 | Pinned Bun version header observed |
| 2 | Initial resolving banner observed |
| 3 | Resolution completion banner, task counter only |
| 4 | Isolated peer-resolution timing marker observed |
| 5 | Isolated store-construction timing marker observed |
| 6 | Pending-task count observed |

Markers are classified output observations. They do not independently attest package installation, exact current internal work, network inactivity, later progress, success, or historical cause. Different streams have no total-order guarantee. Monotonic times belong to the Node collector and do not reconstruct Bun operation timing. A malformed or future marker stays unknown.

Raw stdout and stderr never reach a file, console or upload. They enter bounded in-memory line buffers, are matched against exact allowlists, and are discarded. Package names, URLs, paths, environment/header/token values and arbitrary errors are never copied. CSI decoration is removed before matching; unknown and oversized lines contribute only counts. An untrusted payload can imitate a fixed marker, so marker presence is not stronger than a source-bound output observation.

The collector inspects at most4MiB,512bytes per line and64 marker records across both streams. It drains all remaining bytes without parsing. Partial trailing lines are dropped. Limits, classifier/sink faults and unknown markers remain explicit. The async writer has a32KiB pending queue limit, applies no output-pipe backpressure, and drops observations if unavailable. It owns a new private directory and exclusive file; existing evidence or linked report roots are never overwritten. It finishes retained records before normal runner exit, without a new timer. File I/O and added logging can perturb timing; no zero-perturbation claim is made.

Record kinds0/2 are workflow identity/child PID,1 is a marker,3 is an original incoming signal request,4 is the terminal child status and coverage. Null exit or absent terminal record is unknown. Signal classes1..7 are INT,TERM,HUP,KILL,ABRT,SEGV,PIPE;0 is unknown. Error classes1..5 are ENOENT,EACCES,ENOMEM,EIO,ENOBUFS;0 is unknown. The runtime retains and returns the original error object without publishing its text. Child exit codes and terminal signals remain failing workflow outcomes. A shell-compatible nonzero fallback is set before any self-signal, so a Node-ignored signal cannot yield success. SIGPIPE and SIGUSR1 use that fallback without re-raising, avoiding an ignored signal or inspector startup. Unknown signal numbers fail with1. Spawn errors take precedence over Node's negative close errno; real ENOENT/EACCES map to127/126. Incoming INT/TERM/HUP forward once per delivered signal, without retry or an added kill deadline. SIGKILL cannot be observed; a killed wrapper can leave only a partial prefix. The existing Actions timeout and orphan cleanup still own enforcement.

The new always-run upload retains only this finite prefix separately from the original archive evidence. Its upload is a separate required workflow step; it does not mark a failed install successful or allow subsequent archive checks after install failure. No raw private spool exists. Unavailable retention cannot change the child result; upload/storage availability remains separately observable.

## Validation limits

Node controls exercise split/malformed/large and secret-like chunks, record/byte bounds, classifier/writer faults, one-call argument/environment forwarding, child error identity, signals, real child pipes and failure-before-cleanup retention. Safe disposable Bun1.4.2 offline workspace controls compare the original and verbose modes with unchanged frozen locks. Those controls prove marker availability on the local platform, not macOS archive completion or reproduction of019. Normal source-bound hosted CI supplies that separate evidence. Original reset budgets, tablet attribution, optional xcresult SIGKILL and all native/history limits remain separate.


An offline-fixture failure reports only finite fixture mode, process outcome classes, byte counts, marker stages and coverage. The original exit0 and marker assertions remain required. The e107712 Windows fixture exit1 did not retain its internal Bun error; isolated cold-cache and inherited-PWD controls did not reproduce it locally. Cause remains unknown. The separate existing SQLite five-second timeout is not an archive classifier result or repair claim.


On 2d5a2aa the hosted Windows fixture again returned1 in original mode1, after only the Bun header, with31stdout bytes and131stderr bytes in two unrecognized lines. The current test-only failure context additionally classifies fixed pinned Bun error names. Code0 means unknown;1 is the exact frozen-lock changes message. Codes2..19 correspond in order to AccessDenied, FileNotFound, MissingPackageJSON, InvalidPackageJSON, InvalidLockfile, LockfileResolveFailed, IntegrityCheckFailed, NotDir, NameTooLong, SymLinkLoop, SystemFdQuotaExceeded, SystemResources, NotSameFileSystem, FailedToCopyFile, NotSupported, WriteFailed, CorruptLockfile, InstallFailed. These are output-family observations, not causal proof. At most8 classes survive a bounded1MiB stderr buffer; unsupported/bounded inputs remain unavailable. No text is retained. The fixture and all its original exit/lock/marker assertions remain unchanged. CI=true, GitHub-CI and foreign-PWD local controls also pass, so no environment cause or fix is claimed. Round5 remains unresolved pending actual failure evidence and a supported correction.
