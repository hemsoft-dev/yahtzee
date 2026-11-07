/** Fixed numeric native channel. Raw invalid lines and native names never leave this parser. */
const NUMERIC = new Set(["s", "seq", "pid", "k", "origin", "cx", "q", "target", "u0", "u1", "w", "tt", "phase", "result", "installCode", "hookCount"]);
const COORDS = new Set(["x", "y", "px", "py", "sx", "sy", "ww", "wh", "scale", "orientation", "fx", "fy", "fw", "fh"]);
const FLAGS = new Set(["candidatesTruncated", "movesTruncated"]);
const integer = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const finite = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
function peerValid(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  if (Object.keys(v).length === 0) return true;
  return Object.keys(v).length === 5 && integer(v.kind, 0, 8) && integer(v.state, 0, 5) && integer(v.relation, 0, 4)
    && typeof v.cancels === "boolean" && typeof v.scrollPan === "boolean";
}
function valid(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  if (!integer(row.s, 1, 1) || !integer(row.seq, 0, 2048) || !integer(row.pid, 1, 1e9) || !integer(row.k, 0, 11)
    || !integer(row.origin, 0, 4) || !integer(row.q, 0, 2048) || !integer(row.target, 0, 6)) return false;
  return Object.entries(row).every(([key, v]) => {
    if (COORDS.has(key)) return v === null || integer(v, -1e9, 1e9);
    if (FLAGS.has(key)) return typeof v === "boolean";
    if (key === "peer") return peerValid(v);
    if (key === "candidates") return Array.isArray(v) && v.length <= 8 && v.every(peerValid);
    if (!NUMERIC.has(key) || !finite(v, key === "result" ? -1 : 0, 1e12)) return false;
    if (["cx", "q", "seq", "pid", "target", "phase", "result", "installCode", "hookCount"].includes(key) && !Number.isSafeInteger(v)) return false;
    if (key === "phase" && !integer(v, 0, 7)) return false;
    if (key === "cx" && !integer(v, 0, 2048)) return false;
    if (key === "result" && !integer(v, -1, 1)) return false;
    if (key === "installCode" && !integer(v, 0, 5)) return false;
    if (key === "hookCount" && ![0, 9].includes(v)) return false;
    return true;
  });
}

export function parseNativeCancel(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 4 * 1024 * 1024) return { state: "unavailable", events: [], invalidLines: 0 };
  const lines = text.split("\n"); const partialLastLine = lines.pop() !== "";
  const events = []; let invalidLines = 0;
  for (const line of lines.slice(0, 2049)) {
    let row; try { row = JSON.parse(line); } catch { invalidLines++; continue; }
    if (!valid(row)) { invalidLines++; continue; }
    events.push(row);
  }
  const pids = new Set(events.map((e) => e.pid));
  const contiguous = events.every((e, i) => e.seq === i);
  return { state: lines.length > 2049 ? "truncated" : "parsed", events, invalidLines, partialLastLine,
    singleProcess: pids.size === 1, contiguous, budgetReached: events.some((e) => e.k === 11) };
}

/** Native sample bracket only. Wall interval is conditional on no intervening wall-clock step. */
export function nativeTouchWindow(row) {
  if (![row.u0, row.u1, row.w, row.tt].every(Number.isFinite) || row.u0 > row.u1 || row.u1 - row.u0 > 1
    || row.tt < row.u0 - 30 || row.tt > row.u1) return { state: "unavailable" };
  const coord = [row.x, row.y, row.fx, row.fy, row.fw, row.fh].every(Number.isFinite) && row.fw > 0 && row.fh > 0;
  return { state: "native-sample", sampleSpanMs: (row.u1 - row.u0) * 1000,
    conditionalWallStartMs: (row.w + row.tt - row.u1) * 1000, conditionalWallEndMs: (row.w + row.tt - row.u0) * 1000,
    ageAtSampleMs: (row.u0 - row.tt) * 1000,
    inTargetBounds: coord ? row.x >= row.fx && row.x <= row.fx + row.fw && row.y >= row.fy && row.y <= row.fy + row.fh : null };
}

/** Public entry/call-context attribution, not a claim about private UIKit arbitration. */
export function nativeCancelSummary(parsed) {
  const outcomes = [], starts = new Map(), ended = new Set(), requests = new Map(), contexts = new Set();
  let outcomeCount = 0;
  const events = parsed.singleProcess ? parsed.events : [];
  for (const e of events) {
    if (e.k === 1 && e.q > 0) starts.set(e.q, e);
    if (e.k === 7 && e.q > 0 && e.cx > 0 && e.origin === 3) contexts.add(`${e.cx}:${e.q}`);
    if (e.k === 6 && e.q > 0 && e.cx > 0 && e.origin === 3 && contexts.has(`${e.cx}:${e.q}`)) requests.set(`${e.cx}:${e.q}`, e);
    if ([4, 5].includes(e.k) && e.q > 0 && !ended.has(e.q)) {
      const request = requests.get(`${e.cx}:${e.q}`);
      const explicitRN = e.origin === 3 && request && request.seq < e.seq;
      const origin = explicitRN ? "rn-external-cancel-call" : e.k === 4 ? "uikit-cancel-entry-owner-unknown"
        : e.origin === 4 ? "reset-during-detach" : "reset-entry-owner-unknown";
      outcomeCount++;
      if (outcomes.length < 64) outcomes.push({ pid: e.pid, q: e.q, target: e.target, sequence: e.seq, origin,
        peer: explicitRN ? request.peer : {}, precedingStart: starts.has(e.q), targetAtStart: starts.get(e.q)?.target ?? null, sample: nativeTouchWindow(e) });
      ended.add(e.q);
    }
    if (e.k === 3) ended.add(e.q); // A later recognizer reset is not another cancellation.
  }
  const install = parsed.events.find((e) => e.k === 0);
  return { installed: install?.installCode === 0 && install?.hookCount === 9,
    coverage: parsed.state === "parsed" && parsed.invalidLines === 0 && parsed.singleProcess && parsed.contiguous
      && !parsed.partialLastLine && !parsed.budgetReached ? "retained-prefix" : "partial-or-unavailable",
    outcomes, outcomesTruncated: outcomeCount > 64, absenceProvesNothing: true };
}
