import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseStages, correlateStages, searchCommand } from "./parse.mjs";
import { retainState } from "../comparison/state.mjs";

function read(path, limit) {
  const info = lstatSync(path);
  assert(info.isFile() && !info.isSymbolicLink() && info.size <= limit, "Owned finite regular evidence required.");
  return readFileSync(path, "utf8");
}

function hash(path, limit) {
  const info = lstatSync(path);
  assert(info.isFile() && !info.isSymbolicLink() && info.size <= limit, "Owned staged regular file required.");
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function collectRoute(directory) {
  try {
    const parsed = parseStages(read(join(directory, "reset-mcp.log"), 512 * 1024));
    const calls = read(join(directory, "reset-tool-timing.jsonl"), 1024 * 1024).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const names = readdirSync(directory); assert(names.length <= 1024);
    const classifications = {};
    for (const name of names) {
      const match = /^reset-step-(\d{3})\.yaml$/.exec(name);
      if (match) classifications[Number(match[1])] = searchCommand(read(join(directory, name), 262144));
    }
    return { ...parsed, pairs: correlateStages(parsed, calls, classifications) };
  } catch {
    return { status: "unavailable", coverage: "retained-prefix", absenceProvesNothing: true, events: [], pairs: [] };
  }
}

export function execute() {
  assert.equal(process.platform, "darwin", "The isolated route requires hosted macOS.");
  assert.equal(process.arch, "arm64");
  assert.equal(process.argv.length, 2, "No alternate actions, timing or target options are accepted.");
  const root = resolve(import.meta.dirname, "../../.."), staging = join(root, "reports/.settle-cli");
  const output = join(root, "reports/settle-stage-evidence"), native = join(root, "reports/native-evidence");
  assert(!existsSync(output) && !existsSync(native), "Prior evidence is never overwritten or replayed.");
  const proof = JSON.parse(read(join(staging, "staging-proof.json"), 65536));
  assert.equal(proof.status, "prepared");
  assert.equal(proof.archiveSha256, "29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991");
  assert.equal(proof.upstreamSource, "14a408335e17a090df1e26bdbeaf80d8122a8fd8");
  assert.equal(proof.controls?.publicABIExact, true);
  assert.equal(hash(join(staging, "maestro/lib/maestro-client.jar"), 32 * 1024 ** 2), proof.client.sha256);
  assert.equal(hash(join(staging, "maestro/lib/maestro-cli-2.10.0.jar"), 128 * 1024 ** 2), proof.cliJarSha256);
  assert.equal(hash(join(staging, "maestro/lib/maestro-ios-driver.jar"), 180 * 1024 ** 2), proof.nativeJarSha256);
  assert.equal(hash(join(staging, "maestro/bin/maestro"), 65536), proof.launcherSha256);
  const comparison = JSON.parse(read(join(root, "reports/comparison-build/proof.json"), 65536));
  assert.equal(comparison.status, "prepared");
  assert.equal(comparison.captureControls?.originalMissingCaptureRed, true);
  assert.equal(comparison.captureSourceSha256, proof.comparisonCaptureSourceSha256);
  const comparator = join(staging, "maestro/lib/image-comparison-4.4.0.jar");
  assert.equal(hash(comparator, 1_000_000), comparison.jar.sha256);
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "staging-proof.json"), JSON.stringify(proof, null, 2) + "\n");
  writeFileSync(join(output, "comparison-proof.json"), JSON.stringify(comparison, null, 2) + "\n");
  // Exact small toolchain bytes support offline replay without silently rebuilding a different candidate.
  writeFileSync(join(output, "comparator.jar"), readFileSync(comparator), { flag: "wx", mode: 0o600 });
  const receipt = { schemaVersion: 1, kind: "original-reset-search-settle-observation", status: "running",
    source: null, runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    nativeRunExit: null, routes: [], limits: ["qualification-copy-not-original-package-acceptance", "original-matrix-still-required",
      "daemon-writer-prefix-only", "absence-proves-nothing", "conditional-local-wall-correspondence", "loaded-image-unattested",
      "request-return-is-not-assertion-acceptance", "internal-HTTP-and-AX-stage-reasons-unobserved", "no-historical-cause-or-cure"] };
  const save = () => writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  save();
  try {
    // Same original route, actions, assertions and deadlines, once. No wrapper timeout or retry.
    const result = spawnSync("bun", [join(root, "scripts/ios-native/run.mjs"), "--modal-only"], {
      cwd: root, env: { ...process.env, THIRDROLL_COMPARISON_CAPTURE: "1", PATH: join(staging, "maestro/bin") + ":" + process.env.PATH }, stdio: "inherit" });
    receipt.nativeRunExit = result.status;
    const manifest = JSON.parse(read(join(native, "manifest.json"), 4 * 1024 * 1024));
    assert(/^[a-f0-9]{40}$/.test(manifest.source));
    assert.equal(manifest.runId, receipt.runId); assert.equal(manifest.runAttempt, receipt.runAttempt);
    assert.equal(comparison.source, manifest.source); assert.equal(comparison.runId, receipt.runId); assert.equal(comparison.attempt, receipt.runAttempt);
    receipt.source = manifest.source; receipt.build = manifest.build; receipt.originalRouteStatus = manifest.status;
    for (const [index, name] of ["document", "database"].entries()) {
      const observed = collectRoute(join(native, `corrupt-save/reset-${name}`));
      writeFileSync(join(output, `route-${index + 1}-events.jsonl`), observed.events.map((event) => JSON.stringify(event)).join("\n") + "\n");
      receipt.routes.push({ id: index + 1, ...observed, events: undefined });
      receipt.routes.at(-1).comparisonInput = retainState(join(root, "reports/native/.comparison-retained"), output,
        { source: manifest.source, runId: receipt.runId, attempt: receipt.runAttempt, route: index + 1 }, observed.pairs, true);
    }
    const positive = receipt.routes.every((route) => [1, 2].every((stage) => route.pairs.some((pair) =>
      pair.stage === stage && pair.outcome === "returned" && pair.correspondence === "conditional-local-wall")));
    receipt.status = result.status === 0 && manifest.status === "passed" && positive ? "passed" : "failed";
    process.exitCode = result.status === 0 ? receipt.status === "passed" ? 0 : 1 : result.status ?? 1;
  } catch {
    receipt.status = "failed"; receipt.failure = "original-route-or-finite-retention-unavailable"; process.exitCode = 1;
  } finally { save(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) execute();
