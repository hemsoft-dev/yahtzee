# GH AW on the mini self-hosted runner

Status: Codex pilot compiled and verified, Actions credential required

Last verified: 2026-08-20 from `home`

## Goal

Prove one harmless GitHub Agentic Workflow on the isolated Yahtzee runner.

## Verified infrastructure

- [x] Repository runner `mini-github-runner-01` is online with labels
  `self-hosted`, `Linux`, `X64`, `mini`, and `yahtzee`.
- [x] The runner remains inside Ubuntu 24.04 VM `github-runner-01` with 4 vCPUs,
  5 GiB RAM, and a 100 GiB sparse disk.
- [x] Docker Engine 29.7.2 and Docker Compose 5.5.0 run inside the guest.
- [x] The non-sudo `actions` account can use the guest-local Docker socket.
- [x] GitHub CLI 2.45.0 and ripgrep 14.1.0 are installed in the guest.
- [x] GitHub API and GHCR are reachable over public HTTPS.
- [x] LAN, Tailscale, RFC1918, and link-local access remain blocked from the
  guest after Docker installation.
- [x] Existing manual smoke run
  [32323195241](https://github.com/hemsoft-dev/yahtzee/actions/runs/32323195241)
  succeeded after provisioning.

Node.js is intentionally not installed globally. Current GH AW compilation for
a nonstandard runner must emit `actions/setup-node` and install the selected
Node version within the workflow.

## Safety decisions

- [x] Keep Yahtzee's current self-hosted workflows manual-only while the runner
  is persistent and the repository is public.
- [x] Never route `pull_request`, `pull_request_target`, or untrusted fork code
  to this persistent runner.
- [x] Keep tokens read-only unless a reviewed safe-output job needs a specific
  write permission.
- [x] Change GH AW Markdown source and regenerate `.lock.yml`; never hand-edit a
  generated lock workflow.
- [x] Do not grant the `actions` account sudo and do not expose mini's host
  filesystem or Docker socket.

## Milestone 1: Harmless GH AW smoke

- [x] Resolve and pin the exact `gh aw` compiler version used for the pilot.
  The fixed home binary is stable release `v0.86.2`, tag commit
  `48e5fa3ff52294d91d97715017a9f8693a48387f`. Its Windows AMD64 SHA-256 is
  `1ddfeabde198be39f277001ce4f3daea33366cf98aae7e0a9db3d615bc9df174`,
  which matches the published release asset. The generated lock records
  `compiler_version: "v0.86.2"`.
- [x] Confirm the Codex authentication boundary before adding a secret. The
  local Codex CLI `0.148.0` reports `Logged in using ChatGPT`, which covers
  local subscription use. OpenAI's current authentication documentation says
  programmatic CI/CD should use API-key authentication at standard API rates.
  The pinned GH AW compiler's Codex engine validates either repository secret
  `CODEX_API_KEY` or `OPENAI_API_KEY`; neither secret exists in this repository.
- [x] Add a `workflow_dispatch`-only GH AW Markdown source with zero safe
  outputs and minimum token permissions.
- [x] Target the main agent job with
  `runs-on: [self-hosted, Linux, X64, mini, yahtzee]`.
- [x] Use the built-in Codex engine without a sudo-dependent custom launcher.
  The generated workflow uses SHA-pinned `actions/setup-node` v7 with Node 24,
  then runs `npm install --ignore-scripts -g @openai/codex@0.147.0`. The former
  `.github/scripts/copilot-rootless.sh` launcher and its repository-wide shell
  line-ending rule were removed.
- [x] Compile and validate the generated lock workflow with the pinned compiler.
  `gh aw validate self-hosted-agentic-smoke --strict --json` passes with no
  errors or warnings. An independent actionlint 1.7.12 container run inside the
  guest passed with exit code 0 after ignoring only the configured custom
  runner labels and `gh-aw`'s `concurrency.queue` extension. `gh aw lint`
  separately has a wrapper defect: it reports zero issues and then returns exit
  code 1 with `strict mode: actionlint found 0 errors`.
- [x] Confirm the lock file includes Node setup for the self-hosted runner.
  The main agent job uses SHA-pinned `actions/setup-node` v7 with Node 24.
- [ ] Run the workflow and prove the main agent job used
  `mini-github-runner-01`.
- [ ] Record the run URL, job ID, commit SHA, duration, conclusion, and engine.
- [ ] Confirm post-job workspace and GH AW Docker container cleanup.
- [ ] Record peak guest memory, disk use, and Docker disk use.
- [ ] Re-run guest network-isolation checks after the first GH AW job.

## Milestone 2: Move generated jobs deliberately

- [ ] Decide whether activation, safe-output, maintenance, and other framework
  jobs should remain on `ubuntu-slim` during the pilot.
- [ ] If they move to mini, add matching `runs-on-slim` and safe-output runner
  settings in the Markdown source, then recompile.
- [ ] Prove the single runner's serialized execution does not cause workflow
  timeouts or unacceptable queueing.

## Monitoring

- Runner status: <https://github.com/hemsoft-dev/yahtzee/settings/actions/runners>
- Workflow runs: <https://github.com/hemsoft-dev/yahtzee/actions>
- Existing smoke workflow:
  <https://github.com/hemsoft-dev/yahtzee/actions/workflows/self-hosted-smoke.yml>

## Current blockers

- Repository secret `CODEX_API_KEY` or `OPENAI_API_KEY` has not been created.
  The local ChatGPT-backed Codex login is not a supported substitute for the
  built-in GH AW Codex engine in GitHub Actions.
- Persistent mini runners remain out of scope for untrusted PR code.

## Pilot compile evidence

- Source: `.github/workflows/self-hosted-agentic-smoke.md`
- Generated lock: `.github/workflows/self-hosted-agentic-smoke.lock.yml`
- Compiler-owned reproducibility files: `.github/aw/actions-lock.json` and
  `.gitattributes`; the action lock pins `github/gh-aw-actions/setup@v0.86.2`
  to commit `6aab9e5b5c91c615506061f09bedd81a23babe3c`.
- Compiler validation:
  `gh aw validate self-hosted-agentic-smoke --strict --json`
- Lock inspection confirms compiler `v0.86.2`, Codex CLI `0.147.0`, default
  model `gpt-5.4`, the exact self-hosted label set, Node 24 setup, a rootless
  AWF install, and API-key fallback from `CODEX_API_KEY` to `OPENAI_API_KEY`.
  No Codex install or execution step invokes sudo.
- Independent actionlint used pinned image
  `rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667`
  inside the guest and passed with exit code 0. The actionlint and agent images
  pulled for validation were removed, and no test containers remain.
- Guest isolation was rechecked after the rootless installer test and returned
  `ISOLATION_OK` with Tailscale absent and all tested tailnet, LAN, RFC1918
  destinations blocked.
- Published pilot commit
  `c226a90d039dd68833b1738e0dfe5e25b12d92f4` matches `origin/main` and GitHub
  recognizes active workflow ID `338301135` as `Self-hosted agentic smoke`.
- The previous Copilot launcher commit
  `39059a361357d0f06b2d3b4788521695ce09113e` is historical evidence only. The
  Codex conversion removes that launcher and recompiles the lock from the
  Markdown source.
- Published Codex conversion commit
  `e9e0c7961686c031377b95e89aef968db0a57880` matches local `main`,
  `origin/main`, and GitHub's active workflow ID `338301135`; divergence is
  `0 0`. GitHub reports no runs for the converted workflow.
- On 2026-08-20, strict compile with reviewed secret changes approved completed
  with zero compile warnings. Strict JSON validation returned `valid: true`,
  zero errors, and zero structured warnings. Independent actionlint 1.7.12
  passed in the guest after ignoring only the custom runner labels and GH AW
  `concurrency.queue` extension.
- Runner ID 21 remained online and idle. The runner service was active, Docker
  server `29.7.2` was available to `actions`, no validation containers remained,
  and the post-validation isolation check returned `ISOLATION_OK`.
- No agentic workflow was dispatched because neither supported Codex API secret
  exists.
