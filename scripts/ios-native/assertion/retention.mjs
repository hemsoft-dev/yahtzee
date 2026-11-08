import { basename, join } from "node:path";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";

const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const numeric = value => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const fields = ["v", "source", "run", "attempt", "pid", "id", "flow", "command", "runtimeCommand", "selector", "polarity", "seq", "stage", "phase", "query", "monoNs", "matches", "condition", "error"].sort();

/** Only the original phone5 Solo scenario may enable the private source copy. */
export function assertionEnvironment(env, prefix, directory, readProof = () => {
  const path = "reports/assertion-build/proof.json", info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw new Error();
  return readFileSync(path, "utf8");
}) {
  if (env.THIRDROLL_ASSERT_ENABLE !== "1" || prefix !== "scenario" || basename(directory) !== "phone-5-solo-light") return {};
  try {
    const text = readProof();
    if (typeof text !== "string" || Buffer.byteLength(text) > 65536) return {};
    const proof = JSON.parse(text);
    if (proof.status !== "prepared" || proof.kind !== "qualification-original-assertion-result" ||
      !sha(proof.source) || !numeric(proof.runId) || !numeric(proof.attempt) ||
      proof.source !== env.THIRDROLL_ASSERT_SOURCE || proof.runId !== env.GITHUB_RUN_ID || proof.attempt !== env.GITHUB_RUN_ATTEMPT ||
      proof.upstreamSource !== "14a408335e17a090df1e26bdbeaf80d8122a8fd8" || proof.sourceInverseExact !== true ||
      proof.originalPublicDescriptorsPreserved !== 63 || proof.additionalSyntheticBridges !== 4 ||
      !/^[a-f0-9]{64}$/.test(proof.orchestraSHA256 ?? "")) return {};
    return { THIRDROLL_ASSERT_ENABLE: "1", THIRDROLL_ASSERT_SOURCE: proof.source, THIRDROLL_ASSERT_RUN: proof.runId, THIRDROLL_ASSERT_ATTEMPT: proof.attempt };
  } catch { return {}; }
}

function valid(row, identity) {
  return row && Object.keys(row).sort().join() === fields.join() && row.v === 1 &&
    row.source === identity.THIRDROLL_ASSERT_SOURCE && row.run === identity.THIRDROLL_ASSERT_RUN && row.attempt === identity.THIRDROLL_ASSERT_ATTEMPT &&
    sha(row.source) && numeric(row.run) && numeric(row.attempt) && integer(row.pid, 1, Number.MAX_SAFE_INTEGER) &&
    integer(row.id, 1, 2) && row.flow === 4 && row.command === 8 && integer(row.runtimeCommand, 0, 1000) && row.selector === 1 && row.polarity === 1 &&
    integer(row.seq, 0, 39) && integer(row.stage, 1, 4) && integer(row.phase, 0, 3) && integer(row.query, 0, 16) &&
    (row.monoNs === null || integer(row.monoNs, 0, Number.MAX_SAFE_INTEGER)) && integer(row.matches, -1, 10000) &&
    integer(row.condition, -1, 1) && integer(row.error, 0, 2) &&
    (row.stage === 1 ? row.query === 0 && row.matches === -1 && row.phase <= 2 :
      row.stage === 2 ? row.query > 0 && row.phase <= 2 && (row.phase === 1 || row.matches === -1) :
        row.stage === 3 ? row.query === 0 && row.phase === 1 && row.condition >= 0 && row.matches === -1 :
          row.query === 0 && row.phase === 3 && row.matches === -1);
}

/** Parse only the finite observer vocabulary, never raw diagnostic content. */
export function parseAssertionResults(text, identity) {
  const records = [], contexts = new Map();
  let invalidLines = 0, partial = false, omitted = 0, bytes = 0;
  const prefix = "THIRDROLL_ASSERT ";
  if (typeof text !== "string" || Buffer.byteLength(text) > 262144) return { v: 1, status: "unavailable", reason: "input-bound", records: [], absenceProvesNothing: true };
  const lines = text.split("\n");
  if (lines.at(-1)?.startsWith(prefix)) { lines.pop(); partial = true; }
  for (const line of lines) {
    if (!line.startsWith(prefix)) continue;
    if (line.length > 1024 || records.length >= 80 || bytes + Buffer.byteLength(line) + 1 > 32768) { omitted++; partial = true; continue; }
    try {
      const row = JSON.parse(line.slice(prefix.length));
      if (!valid(row, identity)) throw new Error();
      const key = `${row.pid}:${row.id}`, state = contexts.get(key) ?? { next: 0, closed: false, runtimeCommand: row.runtimeCommand, query: 0, active: new Set() };
      if (state.closed || row.seq !== state.next || (!state.next && !(row.stage === 1 && row.phase === 0))) throw new Error();
      if (row.runtimeCommand !== state.runtimeCommand || (state.next && row.stage === 1 && row.phase === 0)) throw new Error();
      if (contexts.size >= 2 && !contexts.has(key)) throw new Error();
      if (row.stage === 2) {
        if (row.phase === 0) {
          if (row.query !== state.query + 1) throw new Error();
          state.query = row.query; state.active.add(row.query);
        } else {
          if (!state.active.delete(row.query)) throw new Error();
          if (row.phase === 1 && row.matches === -1) partial = true;
        }
      }
      if (row.stage === 1 && row.phase > 0 && state.active.size) partial = true;
      state.next++; state.closed = row.stage === 1 && row.phase > 0;
      contexts.set(key, state);
      if (row.stage === 4 || row.monoNs === null) partial = true;
      bytes += Buffer.byteLength(line) + 1;
      records.push(row);
    } catch { invalidLines++; partial = true; }
  }
  if ([...contexts.values()].some(context => !context.closed)) partial = true;
  return { v: 1, status: !records.length ? "unavailable" : partial ? "partial" : "observed",
    reason: !records.length ? "no-valid-records" : null, records, invalidLines, omitted, retainedBytes: bytes,
    nativeQueryIdentity: "unknown", targetGeometry: "unavailable-not-traversed", visibilityAndUniqueness: "unknown",
    coverage: "retained-prefix", absenceProvesNothing: true };
}

export function retainAssertionResults(text, identity, directory) {
  if (identity.THIRDROLL_ASSERT_ENABLE !== "1") return;
  const result = parseAssertionResults(text, identity);
  writeFileSync(join(directory, "scenario-assertion-results.json"), JSON.stringify(result) + "\n", { flag: "wx", mode: 0o600 });
  return result;
}
