# Application qualification

Application quality runs for every pull request, main update and merge-group candidate. It has no path filters. Linux and Windows each run the locked install, all-workspace/backend/tool typecheck, lint, unit/backend tests, web/desktop production builds, native JavaScript exports and client journeys with the [per-function risk gate](function-risk.md). Each independent check runs after a successful install even if another check failed. A separate hosted Linux job runs the [core-rule mutation gate and weakened-assertion control](mutation-testing.md). A failed, cancelled or skipped matrix or mutation job cannot make `quality-gate` pass.

## Hosted native qualification during the incident

[Issue #130](https://github.com/hemsoft-dev/yahtzee/issues/130) tracks the temporary advisory policy authorised by Chief on November 8. The source-bound simulator build, four device groups, isolated owned-modal route and reset-settle route run on every PR, main push and merge-group candidate. The complete original gameplay and corruption/reset flows execute, with their original assertions, waits, 60000 ms/30-inspection reset limit and 600 ms reset swipes. No per-flow quarantine remains.

Only the outcomes of `native`, `native-modal` and `native-settle` are advisory to `quality-gate`. A failure remains a failed job and retains its original logs, receipts and artifacts. The aggregate prints all three outcomes, emits a warning for unsuccessful or unavailable outcomes, and writes a step summary linked to issue #130. It waits for those outcomes; it does not relabel them as success or use `continue-on-error`. Consequently the workflow may be red from advisory jobs while required `quality-gate` is green. A green aggregate is not native acceptance or App Store acceptance.

Required coverage still includes Linux/Windows validation, browser/component gameplay and durable-persistence suites, mutation, the simulator build, and pinned AX request control. Dependency audit and device archive remain separate required checks. The archive workflow runs on every PR and main push, without path filters, so a CI-only change cannot reuse an older archive pass. Its original install/build/inspection deadlines and assertions are unchanged. Classification remains fail-closed. Only the AX control can skip for an entirely added/modified allowlisted content PR; the build and advisory device routes still run. The unchanged allowlist covers root README, Markdown under docs and named marketing assets. Unknown paths, incomplete diffs, missing base policy or failed classification default to AX qualification, and failed classification blocks the aggregate.

The aggregate depends on every original job but requires success from classification, validation, mutation, native build and AX control. It accepts skipped AX only for a successful explicit content-only classification. Failed, missing, cancelled, pending or unexpectedly skipped required dependencies still fail. No repository protection is bypassed, and no red check that remains required may be merged.

## Evidence and restore condition

The three observed hosted failure classes are reset reachability, score press touch-cancel, and launch-time intro visibility. [Main run 42336675674](https://github.com/hemsoft-dev/yahtzee/actions/runs/42336675674) and [PR run 42507150192](https://github.com/hemsoft-dev/yahtzee/actions/runs/42507150192) retain the original failures. None is relabeled a product or platform cause.

Comparison with [last-green main run 42126414160](https://github.com/hemsoft-dev/yahtzee/actions/runs/42126414160) found a mixed image rollout. Three green groups used macOS 26.6.2/image 20261026.0455.2 and green phone-6 used macOS 26.7.2/image 20261102.0473.1. The first red main run also had passing groups on both images. Xcode 26.6 build 17F113, iOS 26.5, hash-verified Maestro 2.10.0 and the iPhone 17/iPad Pro 13-inch M5 types were already selected and checked. Image movement is correlation, not a proved fix. Standard hosted image build numbers have no supported version pin; no speculative tool downgrade, new runner or paid service is introduced.

Restore mandatory native outcomes after **three consecutive green native runs on main**, or a demonstrated root-cause environment pin that makes the complete native pipeline pass. Use normal source-bound executions, never old-head reruns, empty commits or input replay. Restore the aggregate requirements in a reviewed PR and retain all incident evidence. Issues #41, #102, #112 and #115 remain open until their own criteria are met.

Run `node --test scripts/workflows/*.test.mjs` to check the classifier, real Git diff and CLI behavior, actual workflow conditions, and aggregate shell against success, failure, cancellation and unexpected skips.

Use GitHub-hosted runners for untrusted pull-request code. The persistent mini runner remains manual-only. Workflow tokens are read-only, action references are pinned, jobs have timeouts and newer updates cancel stale runs. No deployment credentials are needed.

The main branch must require the exact status `quality-gate`, require it against an up-to-date branch and require resolved conversations. Disable force pushes and deletions and apply the rule to administrators. Do not bypass a failing application check. Verify these live settings after installing the workflow; checked-in YAML alone is not enforcement.

Connected Codex current-head review is the mission's review policy. It may return a clean comment instead of formal approval. No additional human-approval count is introduced by this workflow. If maintainers add one later, it becomes a separate required gate. Administrative bypasses require an explicit incident decision and must not substitute for missing test evidence.

## Trust boundary

Executing base classifier bytes prevents a classifier edit from authorizing its own native skip. It does not protect against rewriting the PR workflow itself. A required status name is not an immutable-workflow security boundary. A pull request can edit workflow or package scripts, so a green status alone is not permission to merge. Review those edits at the exact candidate head and use the guarded merge process to check the actual workflow run, its steps and resolved review findings. Repository administrators remain trusted to manage settings; these rules do not defend against a malicious administrator.

GitHub's [required-workflow rule](https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-workflows-to-pass-before-merging) is available at organization or enterprise level. This repository is personal-account owned. Moving ownership or provisioning a separate verifier app needs a separate owner decision; this change does not claim that unavailable guarantee or introduce privileged `pull_request_target` execution. Current-head Codex review and guarded merges remain required process controls for workflow/script changes, though branch protection itself does not enforce a Codex comment.

Record run URLs, queue time and final qualification duration when changing CI. No performance target is invented here. Keep additional mutation or soak checks tied to the exact candidate rather than treating scheduled runs of another commit as merge evidence.

Native signed iOS/Android packages are outside this build matrix. Both hosts check mobile TypeScript, Expo/Hermes exports and the mobile-source browser adapter. Desktop checks execute the real Electron main/preload and renderer, but do not prove installation or signing. See [client qualification](client-qualification.md) for the exact platform limits.
