# Agentic workflow maintenance

The smoke workflow is manually dispatched. Do not run it as part of dependency validation: it uses an authenticated agent on a self-hosted runner.

Its Markdown source is `.github/workflows/self-hosted-agentic-smoke.md`. The compiler version is recorded in the generated YAML header. With gh-aw v1.3.0, regenerate it using:

```sh
gh aw compile self-hosted-agentic-smoke --action-mode action --action-tag v1.3.0 --no-check-update
```

Keep the compiler and the `github/gh-aw-actions/setup` tag at the same version. Setup releases are synced from the compiler at that version, and from v1.2.2 the setup action refuses metadata from older compilers: `generate_aw_info.cjs` throws unless the workflow sets `GH_AW_INFO_WORKFLOW_SHA`, which v0.86.2 output never did (#142, #147). The dependency also runs the other way: v1.3.0 output loads `setup_prompt_globals.cjs`, which setup v1.2.2 doesn't ship (#151). If the installed `gh aw` extension is a different version, run the matching release binary instead (for example `windows-amd64.exe compile …` from <https://github.com/github/gh-aw/releases>) after checking it against the release's `checksums.txt`.

Commit `.github/aw/actions-lock.json` and the generated `.lock.yml` together. Check that the compiler manifest, action summary, and all `uses:` entries agree with the action lock. Compile a second time and verify that no further diff appears.

Dependabot changes `uses:` entries, but does not refresh the compiler manifest or action lock. Review those files whenever it proposes an action upgrade. A setup-action bump is a compiler upgrade: close it with a link to a compiler-upgrade issue, or do that upgrade, rather than recompiling with the old compiler at the new tag.

The v1.3.0 compiler emits its own Node setup action (`actions/setup-node` v7.1.0 at `949feb24`, the same pin as `quality.yml`). Unlike v0.86.2, it honors a `runtimes.node` `action-repo`/`action-version` override in the workflow frontmatter, and it uses an `actions/setup-node` entry in `.github/aw/actions-lock.json` when that entry is newer than its embedded default (gh-aw v1.3.0 `pkg/workflow/nodejs.go` and `action_pins.go`, unchanged in this respect since v1.2.2). To move that pin, change the override or the lock and recompile. A generated `uses:`-only edit is still undone on regeneration. The generated manifest, action summary and runtime references must agree. `node --test scripts/workflows/*.test.mjs` checks those relationships and the persisted action lock in both platform validation jobs, including rejection of a `uses:`-only update.

A compiler upgrade is a separate change. It can change permissions, container images, telemetry, and generated job logic. Do not accept that wider diff merely to refresh one action dependency.

## v1.2.2 → v1.3.0 review (November 20, 2026, #151)

The compiler came from the v1.3.0 `windows-amd64.exe` release binary, which matched the release's `checksums.txt` (SHA-256 `00fd9271…c7d893`). GitHub marks that release as a pre-release. Setup v1.3.0 is commit `8126d6cb` ("sync actions from gh-aw@v1.3.0"), the same pin #151 proposed. The second compile gave no diff.

- **Agent job:** still `contents: read`, with no write scope and `tools: {}`. Every job's `permissions` block is identical to v1.2.2, as are the job list, the self-hosted runner labels and the safe-output `create_issue` tool.
- **Generated job logic:** the activation job skips the lock-file and compiler-version checks, and the agent job skips the run, when the daily AI-credit guardrail reports `quota_blocked`. `GH_AW_MAX_AI_CREDITS` now also accepts `-1`; this workflow still sets 30. The agent step summary is appended only after secret redaction succeeds.
- **Prompt environment:** the inline allowlist that cleared `process.env` before prompt rendering moved into setup's `setup_prompt_globals.cjs`. It merges a fixed list of runner variables with the step's `GH_AW_PROMPT_ENV`. The combined names are the same as the old inline set, and the helper throws if `GH_AW_PROMPT_ENV` is missing or malformed.
- **Telemetry and secrets:** no change. The manifest lists the same secrets, and the OTLP export still reads `secrets.GH_AW_DEFAULT_OTLP_ENDPOINT || vars.GH_AW_DEFAULT_OTLP_ENDPOINT` with `GH_AW_OTLP_IF_MISSING: ignore`. On November 20 the repository still had no Actions secrets or variables and could see no organization ones. It has two environments, but the workflow uses neither, so export stays off. Setup v1.3.0's `check_otlp_default_credentials.sh` still treats an empty endpoint as "telemetry export is simply disabled".
- **Containers:** still digest-pinned, no new image. gh-aw-firewall moves from 0.29.11 to 0.29.14 (agent `7f649a02…`, api-proxy `13678563…`, squid `878b9c1a…`) and gh-aw-mcpg from v0.5.6 to v0.5.10 (`629ddcd6…`). gh-aw-node and github-mcp-server v2.1.0 keep their digests. The AWF config's image list drops the unused `agent-act` digest, and `cli-proxy` gets a new digest. As before, the MCP gateway config names `github-mcp-server:v2.1.0` by tag, and the image is pre-pulled by digest.
- **Engine and installer:** Codex CLI moves from 0.166.0 to 0.167.0, installed with `NPM_CONFIG_IGNORE_SCRIPTS`. From v1.3.0, AWF downloads fail closed without a pinned checksum. The workflow installs AWF v0.29.14 without a `--checksums-sha256` argument and relies on the `checksums.txt` digest that setup v1.3.0 bundles in `release_integrity.sh`.
- **Manifest:** only the setup action pin and the container entries change. The MCP tools, `admission: false` and `threat_detection: disabled` are unchanged. The action lock swaps `github/gh-aw-actions/setup@v1.2.2` for `@v1.3.0` at `8126d6cb`, and it agrees with the manifest, the action summary and every `uses:` entry.
- **actionlint 1.7.12:** the same four baseline diagnostics as v1.2.2 (see the last paragraph of this page), with no new ones. The run disabled shellcheck and pyflakes; a full run with shellcheck didn't finish within two minutes on Windows.

The other v1.3.0 breaking changes don't reach this workflow. It uses no Jira, Linear or Azure DevOps integration, no Copilot engine (so no model-routing default), no `pull_request_target`, no `merge-pull-request`, no graders and no work queue.

## v0.86.2 → v1.2.2 review (November 15, 2026, #147)

- **Agent job:** unchanged at `contents: read`. The model still runs with no write scope and `tools: {}`.
- **Generated jobs:** `activation` gains `issues: write` (already held by `conclusion` and `safe_outputs`). `conclusion` gains read-only `checks` and `pull-requests`.
- **Telemetry:** new OTLP export steps read `secrets.GH_AW_DEFAULT_OTLP_ENDPOINT || vars.GH_AW_DEFAULT_OTLP_ENDPOINT` with `GH_AW_OTLP_IF_MISSING: ignore`. The repository has no Actions secrets or variables, sees no organization secrets or variables, and the workflow uses no environment, so the endpoint is empty. The setup action's `check_otlp_default_credentials.sh` then skips export ("telemetry export is simply disabled"). Setting that secret or variable anywhere in scope turns export on; review it before doing so.
- **Containers:** still digest-pinned, moved to gh-aw-firewall 0.29.11, gh-aw-mcpg v0.5.6 and github-mcp-server v2.1.0. No new image.
- **Manifest:** now also lists the MCP tools (read-only GitHub tools plus safe-output `create_issue`), `admission: false` and `threat_detection: disabled`. Jobs and runners are unchanged; the `actions/cache` steps are gone.

Some generated syntax is newer than installed actionlint versions. actionlint 1.7.12 reports concurrency `queue: max` (now at both workflow and job level) as an unexpected key. It also reports `job.workflow_ref` and `job.workflow_sha` as undefined. Those are documented `job` context properties on github.com, which the generated activation job passes to setup (v1.2.2 and later) as `GH_AW_INFO_WORKFLOW_ID` and `GH_AW_INFO_WORKFLOW_SHA`. Record these baseline diagnostics. Don't delete generated concurrency controls or metadata to silence an old linter. Hosted application checks remain required.
