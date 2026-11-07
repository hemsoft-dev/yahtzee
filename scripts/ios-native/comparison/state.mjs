import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

const integer = (n, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= min && n <= max;
const fields = ["v", "source", "runId", "attempt", "route", "pid", "stage", "id", "parentId", "code", "seenAtCopy", "omissionsAfterCopy",
  "width", "height", "count", "counter", "regions", "threshold", "minimum", "allowing", "bytes", "sha256", "copyBeginNs", "copyEndNs", "copyLimitNs", "writeLimitNs"].sort();

/** A binary difference mask is region-work input, never a screenshot or full-comparator oracle. */
export function validateState(metadata, bytes, identity, pairs) {
  assert.deepEqual(Object.keys(metadata).sort(), fields);
  assert.equal(metadata.v, 1); assert.equal(metadata.code, 0); assert.equal(metadata.stage, 6);
  for (const k of ["source", "runId", "attempt", "route"]) assert.equal(metadata[k], identity[k]);
  assert(/^[a-f0-9]{40}$/.test(metadata.source));
  assert(/^[0-9]{1,20}$/.test(metadata.runId) && /^[0-9]{1,20}$/.test(metadata.attempt));
  assert(integer(metadata.route, 1, 2) && integer(metadata.pid, 1));
  assert(integer(metadata.id, 1, 128) && integer(metadata.parentId, 1, metadata.id - 1));
  assert(integer(metadata.seenAtCopy, 1, 128) && metadata.omissionsAfterCopy === null);
  assert(integer(metadata.width, 1, 8192) && integer(metadata.height, 1, 8192));
  const cells = metadata.width * metadata.height;
  assert(cells <= 8_000_000 && integer(metadata.count, 0, cells));
  assert.equal(metadata.bytes, Math.ceil(cells / 8)); assert(metadata.bytes <= 1_000_000);
  assert(Buffer.isBuffer(bytes) && bytes.length === metadata.bytes);
  assert.equal(metadata.counter, 2); assert.equal(metadata.regions, 2); assert.equal(metadata.threshold, 5);
  assert.equal(metadata.minimum, 1); assert.equal(metadata.allowing, 0);
  assert.equal(metadata.copyLimitNs, 200_000_000); assert.equal(metadata.writeLimitNs, 500_000_000);
  assert(integer(metadata.copyBeginNs) && integer(metadata.copyEndNs, metadata.copyBeginNs));
  assert(metadata.copyEndNs - metadata.copyBeginNs <= metadata.copyLimitNs);
  assert(/^[a-f0-9]{64}$/.test(metadata.sha256));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), metadata.sha256);
  let count = 0;
  for (const value of bytes) { let n = value; while (n) { count += n & 1; n >>>= 1; } }
  if (cells % 8) assert.equal(bytes.at(-1) >>> (cells % 8), 0);
  assert.equal(count, metadata.count);
  const matched = pairs.filter(p => p.stage === 6 && p.pid === metadata.pid && p.id === metadata.id && p.parentId === metadata.parentId &&
    p.beginMonotonicNs <= metadata.copyBeginNs && metadata.copyEndNs <= p.endMonotonicNs);
  // Preserve reconstructible data even when a dropped stage suffix prevents correspondence.
  return { status: "retained", representation: "binary-predicate-matrix-before-grouping", metadata,
    stageCorrespondence: matched.length === 1 ? "same-process-stage-scope" : "unknown",
    flowSequence: matched.length === 1 ? matched[0].flowSequence ?? null : null,
    requestCorrespondence: matched.length === 1 ? matched[0].correspondence ?? "unknown" : "unknown",
    coverage: "retained-prefix", omissionsAfterCopy: "unknown", outputTime: "cooperative-budget-kernel-blocking-unattested",
    fullComparatorEquivalence: false, timingPerturbed: true };
}

function read(path, limit) {
  const info = lstatSync(path); assert(info.isFile() && !info.isSymbolicLink() && info.size <= limit);
  return readFileSync(path);
}

/** Only the isolated synthetic reset scope gets an output directory and enablement. */
export function captureEnvironment(env, name, directory, modalOnly, source) {
  if (env.THIRDROLL_COMPARISON_CAPTURE !== "1") return env;
  if (!modalOnly) return { ...env, THIRDROLL_COMPARISON_CAPTURE: "0" };
  try {
    assert(["reset-document", "reset-database"].includes(name) && /^[a-f0-9]{40}$/.test(source));
    const root = join(directory, ".comparison-input"); mkdirSync(root, { mode: 0o700 });
    return { ...env, THIRDROLL_CAPTURE_SOURCE: source, THIRDROLL_CAPTURE_ROUTE: name === "reset-document" ? "1" : "2",
      THIRDROLL_CAPTURE_DIRECTORY: root };
  } catch { return { ...env, THIRDROLL_COMPARISON_CAPTURE: "0" }; }
}

/** Preserve only this authored capture identity across the existing launcher filter. */
export function captureChildEnvironment(env, prefix, directory) {
  if (prefix !== "reset" || env.THIRDROLL_COMPARISON_CAPTURE !== "1") return {};
  try {
    assert(isAbsolute(directory));
    const route = { "reset-document": "1", "reset-database": "2" }[basename(directory)];
    assert(route && env.THIRDROLL_CAPTURE_ROUTE === route);
    assert(typeof env.THIRDROLL_CAPTURE_SOURCE === "string" && /^[a-f0-9]{40}$/.test(env.THIRDROLL_CAPTURE_SOURCE));
    for (const key of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]) {
      assert(typeof env[key] === "string" && /^[1-9][0-9]{0,19}$/.test(env[key]));
    }
    const input = join(directory, ".comparison-input");
    assert(input.length <= 4096 && ![...input].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) && env.THIRDROLL_CAPTURE_DIRECTORY === input);
    for (const path of [directory, input]) {
      const info = lstatSync(path); assert(info.isDirectory() && !info.isSymbolicLink());
    }
    return Object.fromEntries(["THIRDROLL_COMPARISON_CAPTURE", "THIRDROLL_CAPTURE_SOURCE", "THIRDROLL_CAPTURE_ROUTE",
      "THIRDROLL_CAPTURE_DIRECTORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"].map(key => [key, env[key]]));
  } catch { return {}; }
}

export function retainState(directory, output, identity, pairs, prepared = false) {
  const unavailable = reason => ({ status: "unavailable", reason, coverage: "retained-prefix", absenceProvesNothing: true });
  try {
    const input = prepared ? directory : join(directory, ".comparison-input");
    const metadataName = prepared ? `matrix-${identity.route}.json` : "matrix.json";
    if (!existsSync(join(input, metadataName))) {
      // Only fixed code, never arbitrary partial metadata or error text.
      let reason = 0;
      for (const name of ["attempt.json", "first.json"]) {
        try {
          const status = JSON.parse(read(join(input, name), 2048).toString("utf8"));
          const statusFields = fields.filter(k => !["width", "height", "count", "counter", "regions", "threshold", "minimum", "allowing",
            "bytes", "sha256", "copyBeginNs", "copyEndNs", "copyLimitNs", "writeLimitNs"].includes(k));
          if (Object.keys(status).sort().join() === statusFields.join() && integer(status.code, 1, 5) && status.v === 1 && status.stage === 6 &&
              integer(status.pid, 1) && integer(status.id, 1, 128) && integer(status.parentId, 1, status.id - 1) &&
              integer(status.seenAtCopy, 1, 128) && status.omissionsAfterCopy === null &&
              ["source", "runId", "attempt", "route"].every(k => status[k] === identity[k])) { reason = status.code; break; }
        } catch { /* Unknown partial/missing status is not an absence verdict. */ }
      }
      return unavailable(reason);
    }
    const envelope = JSON.parse(read(join(input, metadataName), prepared ? 8192 : 2048).toString("utf8"));
    const metadata = prepared ? envelope.metadata : envelope;
    const bytes = read(join(input, prepared ? `matrix-${identity.route}.bin` : "matrix.bin"), 1_000_000);
    const result = validateState(metadata, bytes, identity, pairs);
    mkdirSync(output, { recursive: true, mode: 0o700 });
    writeFileSync(join(output, `matrix-${identity.route}.bin`), bytes, { flag: "wx", mode: 0o600 });
    writeFileSync(join(output, `matrix-${identity.route}.json`), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return { ...result, path: `matrix-${identity.route}.bin` };
  } catch { return unavailable(0); }
}
