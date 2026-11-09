# Windows mobile export observation

[Issue134](https://github.com/hemsoft-dev/yahtzee/issues/134) tracks two Windows job timeouts during the combined mobile export. Their downloadable logs are missing, so the original internal hang remains unknown.

On Windows, the existing export step invokes `node scripts/workflows/mobile-export.mjs`. It starts exactly one original `bun run build:mobile` child with the original environment, working directory and arguments. Linux keeps its original command. The 15-minute job deadline, platform exports, workers, assertions and required aggregate are unchanged. There is no retry, sampler, timer, extra export, cache or dependency change.

The observer reads the child's existing stdout/stderr and forwards those bytes. It also emits fixed numeric [GitHub notice annotations](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-a-notice-message), available through the job's check annotation API. Each annotation is bound to that original check's source/run/job identity. No later request is associated by wall time alone.

| Stage | Observed boundary |
| --- | --- |
| 1 | Wrapper entered, before the one child invocation |
| 2 | Node reported child spawn |
| 3 / 6 | Original Android / iOS `Starting Metro Bundler` output marker |
| 4 / 7 | Original Android / iOS `Bundled` output marker |
| 5 / 8 | Original Android / iOS output-directory completion marker |
| 9 | Child close event, with numeric exit and signal class |
| 10 | Child spawn error, with finite error class |
| 11 | Unsupported, out-of-order, oversized or incomplete observation |

`code=-1` means no supported exit code. Spawn-error classes are `1=ENOENT`, `2=EACCES`, `0=other`. Signal classes are `1=SIGTERM`, `2=SIGKILL`, `3=SIGINT`, `0=none or unsupported`. Raw error text is never included. Nonzero/error/signal outcomes still fail; observation does not replace the child result.

There are at most ten annotations, once per stage, and under 2 KiB of diagnostic text. The budget reserves the final close record and marks exhausted observation capacity unavailable. Two fixed 8192-byte line buffers bound retained output. Oversized lines are discarded by the observer, while the original output is still forwarded. Partial lines and unsupported order mark observation unavailable. Unknown lines produce no diagnostic value. Annotation sink or clock failure cannot change the child outcome. `ms=-1` means the clock was unavailable; other elapsed values are capped at 2147483647 ms.

Original stdout and stderr bytes remain in their original streams. Notices add explicitly framed lines to stdout and may perturb buffering and elapsed time. Output markers prove only that those bytes were observed, not that an internal operation returned, that a timeout has one particular cause, or that the notice survived runner/service failure. Missing notices are not absence-of-execution proof. No raw paths, environment, URLs, arbitrary error payloads or user content are copied into notices.

Run `node --test scripts/workflows/mobile-export.test.mjs`. The actual pinned Bun workspace control preserves original output, its nonzero result and one invocation per run. A separate Node child control preserves exit 7. `MOBILE_EXPORT_BASELINE=1` makes the Bun control use the original unobserved command and fail solely because its completion annotation is absent. This is a missing-observation control, not a reproduction of the hosted hang. A successful current export likewise does not explain either historical timeout.

The exact locked local export also completed through the observer. Asset and metadata bytes and bundle filenames matched the original command. HBC binary hashes varied between two unobserved original exports too, so no byte-reproducibility claim is made for Hermes output. These controls establish observation and forwarding capability, not a compiler, host or historical-hang cause.
