# Application qualification

Application quality runs for every pull request, main update and merge-group candidate. It has no path filters. Linux and Windows each run the locked install, all-workspace/backend/tool typecheck, lint, unit/backend tests, web/desktop production builds, native JavaScript exports and client journeys with the [per-function risk gate](function-risk.md). Each independent check runs after a successful install even if another check failed. A separate hosted Linux job runs the [core-rule mutation gate and weakened-assertion control](mutation-testing.md). A failed, cancelled or skipped matrix or mutation job cannot make `quality-gate` pass.

## Native qualification

Hosted iOS simulator qualification was removed on November 21, 2026 because there will be no iOS release. The simulator build, device-group, owned-modal, reset-settle and AX request jobs, the iOS device archive workflow and the content-only classifier that let documentation-only pull requests skip those jobs were removed with it. No workflow builds or runs the native iOS or Android app.

The required `quality-gate` runs with `always()` and depends on the Linux/Windows `validate` matrix and the `mutation` job. It passes only when both succeed. A failed, cancelled or skipped job fails the aggregate. Dependency audit remains a separate required check.

## Hosted native incident (#130)

From November 8, 2026 the hosted simulator device groups, owned-modal and reset-settle jobs were temporarily advisory to `quality-gate` under [issue #130](https://github.com/hemsoft-dev/yahtzee/issues/130). The observed hosted failures were reset reachability, score-press touch cancellation and launch-time intro visibility. #138 and #141 addressed those races, and the jobs became required again after three consecutive green native runs on main. The jobs were removed on November 21, 2026 with the rest of the iOS simulator qualification, so this incident no longer affects the gate.

Run `node --test "scripts/workflows/*.test.mjs"` to check the Windows Expo export observer, the generated agentic workflow's action pins, the `quality-gate` aggregate and job guards in `quality.yml`, and the privacy wording in the issue templates and `SECURITY.md`.

Use GitHub-hosted runners for untrusted pull-request code. The persistent mini runner remains manual-only. Workflow tokens are read-only, action references are pinned, jobs have timeouts and newer updates cancel stale runs. No deployment credentials are needed.

The main branch must require the exact statuses `quality-gate` and `dependency-audit`, require them against an up-to-date branch and require resolved conversations. Disable force pushes and deletions and apply the rule to administrators. Do not bypass a failing application check. Verify these live settings after changing the workflows; checked-in YAML alone is not enforcement.

Connected Codex current-head review is the mission's review policy. It may return a clean comment instead of formal approval. No additional human-approval count is introduced by this workflow. If maintainers add one later, it becomes a separate required gate. Administrative bypasses require an explicit incident decision and must not substitute for missing test evidence.

## Trust boundary

A required status name is not an immutable-workflow security boundary. A pull request can edit workflow or package scripts, so a green status alone is not permission to merge. Review those edits at the exact candidate head and use the guarded merge process to check the actual workflow run, its steps and resolved review findings. Repository administrators remain trusted to manage settings; these rules do not defend against a malicious administrator.

GitHub's [required-workflow rule](https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-workflows-to-pass-before-merging) is available at organization or enterprise level. This repository is personal-account owned. Moving ownership or provisioning a separate verifier app needs a separate owner decision; this policy does not claim that unavailable guarantee or introduce privileged `pull_request_target` execution. Current-head Codex review and guarded merges remain required process controls for workflow/script changes, though branch protection itself does not enforce a Codex comment.

Record run URLs, queue time and final qualification duration when changing CI. No performance target is invented here. Keep additional mutation or soak checks tied to the exact candidate rather than treating scheduled runs of another commit as merge evidence.

Native signed iOS/Android packages are outside this build matrix. Both hosts check mobile TypeScript, Expo/Hermes exports and the mobile-source browser adapter. Desktop checks execute the real Electron main/preload and renderer, but do not prove installation or signing. See [client qualification](client-qualification.md) for the exact platform limits.
