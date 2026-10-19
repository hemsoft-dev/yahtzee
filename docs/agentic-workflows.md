# Agentic workflow maintenance

The smoke workflow is manually dispatched. Do not run it as part of dependency validation: it uses an authenticated agent on a self-hosted runner.

Its Markdown source is `.github/workflows/self-hosted-agentic-smoke.md`. The compiler version is recorded in the generated YAML header. With gh-aw v0.86.2, regenerate the current action upgrade using:

```sh
gh aw compile self-hosted-agentic-smoke --action-mode action --action-tag v0.92.4 --no-check-update
```

Commit `.github/aw/actions-lock.json` and the generated `.lock.yml` together. Check that the compiler manifest, action summary, and all `uses:` entries agree with the action lock. Compile a second time and verify that no further diff appears.

Dependabot changes `uses:` entries, but does not refresh the compiler manifest or action lock. Review those files whenever it proposes an action upgrade. Specify the intended action tag when using an older compiler; a bare compile uses that compiler's defaults and can undo a newer action pin.

The pinned v0.86.2 compiler emits its own Node setup action. Keep that generated reference at the compiler's version when updating handwritten workflows. Its default setup steps ignore the runtime action override and action lock; a generated `uses:`-only edit is undone on regeneration. The generated manifest, action summary and runtime references must agree. `node --test scripts/workflows/*.test.mjs` checks those relationships and the persisted action lock in both platform validation jobs, including rejection of a `uses:`-only update.

A compiler upgrade is a separate change. It can change permissions, container images, telemetry, and generated job logic. Do not accept that wider diff merely to refresh one action dependency.

The current generated concurrency `queue: max` syntax is newer than some installed actionlint versions. Record an identical baseline diagnostic rather than deleting generated concurrency controls to silence an old linter. Hosted application checks remain required.
