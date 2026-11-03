# Application qualification

Application quality runs for every pull request, main update and merge-group candidate. It has no path filters. Linux and Windows each run the locked install, all-workspace/backend/tool typecheck, lint, unit/backend tests, web/desktop production builds, native JavaScript exports and client journeys with the [per-function risk gate](function-risk.md). Each independent check runs after a successful install even if another check failed. A separate hosted Linux job runs the [core-rule mutation gate and weakened-assertion control](mutation-testing.md). A failed, cancelled or skipped matrix or mutation job cannot make `quality-gate` pass.

## Native qualification for content changes

Only pull requests consisting entirely of added or modified allowlisted content skip the native build and all four native qualification groups. The allowlist in [`docs-only-native.mjs`](../scripts/workflows/docs-only-native.mjs) covers root `README.md`, Markdown files under `docs/`, and these standalone marketing files: `site/pages.mjs`, `site/style.css`, `site/README.md`, `site/assets/iphone-setup.png` and `site/assets/iphone-help.png`. Site build and test scripts, machine-readable documentation, and new unlisted marketing paths require native qualification.

The classifier checks the complete Git three-dot PR diff using event base/head revisions and verifies its file count against the event. Missing revisions or history, incomplete or malformed data, classifier errors, renames, deletions, and any mixed or unlisted change require the full native suite. Every main push and merge-group candidate runs the full suite. App, workflow, native tooling and dependency changes therefore always run native qualification, including a PR changing this classifier or workflow.

The same required `quality-gate` still runs with `always()`. It accepts skipped native jobs only when classification succeeded with an explicit content-only result and both native jobs were skipped. Otherwise both native jobs must succeed. A failed classification job fails the aggregate, and the native jobs default to running. All non-native checks, required check names, native runners, matrices and deadlines stay in force. No workflow-level path ignore leaves required checks pending.

Run `node --test scripts/workflows/*.test.mjs` to check the classifier, real Git diff and CLI behavior, actual workflow conditions, and aggregate shell against success, failure, cancellation and unexpected skips.

Use GitHub-hosted runners for untrusted pull-request code. The persistent mini runner remains manual-only. Workflow tokens are read-only, action references are pinned, jobs have timeouts and newer updates cancel stale runs. No deployment credentials are needed.

The main branch must require the exact status `quality-gate`, require it against an up-to-date branch and require resolved conversations. Disable force pushes and deletions and apply the rule to administrators. Do not bypass a failing application check. Verify these live settings after installing the workflow; checked-in YAML alone is not enforcement.

Connected Codex current-head review is the mission's review policy. It may return a clean comment instead of formal approval. No additional human-approval count is introduced by this workflow. If maintainers add one later, it becomes a separate required gate. Administrative bypasses require an explicit incident decision and must not substitute for missing test evidence.

## Trust boundary

A required status name is not an immutable-workflow security boundary. A pull request can edit workflow or package scripts, so a green status alone is not permission to merge. Review those edits at the exact candidate head and use the guarded merge process to check the actual workflow run, its steps and resolved review findings. Repository administrators remain trusted to manage settings; these rules do not defend against a malicious administrator.

GitHub's [required-workflow rule](https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-workflows-to-pass-before-merging) is available at organization or enterprise level. This repository is personal-account owned. Moving ownership or provisioning a separate verifier app needs a separate owner decision; this change does not claim that unavailable guarantee or introduce privileged `pull_request_target` execution. Current-head Codex review and guarded merges remain required process controls for workflow/script changes, though branch protection itself does not enforce a Codex comment.

Record run URLs, queue time and final qualification duration when changing CI. No performance target is invented here. Keep additional mutation or soak checks tied to the exact candidate rather than treating scheduled runs of another commit as merge evidence.

Native signed iOS/Android packages are outside this build matrix. Both hosts check mobile TypeScript, Expo/Hermes exports and the mobile-source browser adapter. Desktop checks execute the real Electron main/preload and renderer, but do not prove installation or signing. See [client qualification](client-qualification.md) for the exact platform limits.
