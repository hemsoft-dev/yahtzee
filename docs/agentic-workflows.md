# Agentic workflow maintenance

The smoke workflow is manually dispatched. Do not run it as part of dependency validation: it uses an authenticated agent on a self-hosted runner.

Its Markdown source is `.github/workflows/self-hosted-agentic-smoke.md`. The compiler version is recorded in the generated YAML header. With gh-aw v1.2.2, regenerate it using:

```sh
gh aw compile self-hosted-agentic-smoke --action-mode action --action-tag v1.2.2 --no-check-update
```

Keep the compiler and the `github/gh-aw-actions/setup` tag at the same version. Setup releases are synced from the compiler at that version, and from v1.2.2 the setup action refuses metadata from older compilers: `generate_aw_info.cjs` throws unless the workflow sets `GH_AW_INFO_WORKFLOW_SHA`, which v0.86.2 output never did (#142, #147). If the installed `gh aw` extension is a different version, run the matching release binary instead (for example `windows-amd64.exe compile …` from <https://github.com/github/gh-aw/releases>) after checking it against the release's `checksums.txt`.

Commit `.github/aw/actions-lock.json` and the generated `.lock.yml` together. Check that the compiler manifest, action summary, and all `uses:` entries agree with the action lock. Compile a second time and verify that no further diff appears.

Dependabot changes `uses:` entries, but does not refresh the compiler manifest or action lock. Review those files whenever it proposes an action upgrade. A setup-action bump is a compiler upgrade: close it with a link to a compiler-upgrade issue, or do that upgrade, rather than recompiling with the old compiler at the new tag.

The v1.2.2 compiler emits its own Node setup action (`actions/setup-node` v7.1.0 at `949feb24`, the same pin as `quality.yml`). Unlike v0.86.2, it honors a `runtimes.node` `action-repo`/`action-version` override in the workflow frontmatter, and it uses an `actions/setup-node` entry in `.github/aw/actions-lock.json` when that entry is newer than its embedded default (gh-aw v1.2.2 `pkg/workflow/nodejs.go` and `action_pins.go`). To move that pin, change the override or the lock and recompile. A generated `uses:`-only edit is still undone on regeneration. The generated manifest, action summary and runtime references must agree. `node --test scripts/workflows/*.test.mjs` checks those relationships and the persisted action lock in both platform validation jobs, including rejection of a `uses:`-only update.

A compiler upgrade is a separate change. It can change permissions, container images, telemetry, and generated job logic. Do not accept that wider diff merely to refresh one action dependency.

## v0.86.2 → v1.2.2 review (November 15, 2026, #147)

- **Agent job:** unchanged at `contents: read`. The model still runs with no write scope and `tools: {}`.
- **Generated jobs:** `activation` gains `issues: write` (already held by `conclusion` and `safe_outputs`). `conclusion` gains read-only `checks` and `pull-requests`.
- **Telemetry:** new OTLP export steps read `secrets.GH_AW_DEFAULT_OTLP_ENDPOINT || vars.GH_AW_DEFAULT_OTLP_ENDPOINT` with `GH_AW_OTLP_IF_MISSING: ignore`. The repository has no Actions secrets or variables, sees no organization secrets or variables, and the workflow uses no environment, so the endpoint is empty. The setup action's `check_otlp_default_credentials.sh` then skips export ("telemetry export is simply disabled"). Setting that secret or variable anywhere in scope turns export on; review it before doing so.
- **Containers:** still digest-pinned, moved to gh-aw-firewall 0.29.11, gh-aw-mcpg v0.5.6 and github-mcp-server v2.1.0. No new image.
- **Manifest:** now also lists the MCP tools (read-only GitHub tools plus safe-output `create_issue`), `admission: false` and `threat_detection: disabled`. Jobs and runners are unchanged; the `actions/cache` steps are gone.

The current generated concurrency `queue: max` syntax is newer than some installed actionlint versions. Record an identical baseline diagnostic rather than deleting generated concurrency controls to silence an old linter. Hosted application checks remain required.
