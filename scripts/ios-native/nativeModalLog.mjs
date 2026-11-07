import { nativeTouchWindow } from "./nativeCancelLog.mjs";

const INTS = Object.freeze({ s: [1, 1], seq: [0, 2048], pid: [1, 1e9], epoch: [1, Number.MAX_SAFE_INTEGER],
  k: [0, 12], a: [0, 128], win: [0, 128], d: [0, 2048], q: [0, 128], target: [0, 2], code: [0, 8], hookCount: [0, 3], phase: [0, 7] });
const COORDS = new Set(["x", "y", "px", "py", "sx", "sy", "fx", "fy", "fw", "fh", "ww", "wh", "scale", "orientation"]);
const FLAGS = new Set(["completionSupplied", "callbackDirect", "hidden", "scene", "presented", "candidatesTruncated"]);
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
function candidate(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 4
    && integer(value.kind, 0, 6) && integer(value.state, 0, 5) && integer(value.relation, 0, 2) && typeof value.cancels === "boolean";
}
function valid(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  if (!["s", "seq", "pid", "epoch", "k", "a", "win", "d", "q", "target"].every((key) => INTS[key] && integer(row[key], ...INTS[key]))) return false;
  return Object.entries(row).every(([key, value]) => {
    if (Object.hasOwn(INTS, key)) return integer(value, ...INTS[key]);
    if (COORDS.has(key)) return value === null || integer(value, -1e9, 1e9);
    if (FLAGS.has(key)) return typeof value === "boolean" && (key !== "callbackDirect" || value === false);
    if (["u0", "u1", "tt", "w"].includes(key)) return Number.isFinite(value) && value >= 0 && value <= 1e12;
    return key === "candidates" && Array.isArray(value) && value.length <= 8 && value.every(candidate);
  });
}

/** Raw invalid strings are dropped, never frozen into evidence. */
export function parseNativeModal(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 4 * 1024 * 1024) return { state: "unavailable", events: [], invalidLines: 0 };
  const lines = text.split("\n"), partialLastLine = lines.pop() !== "";
  const events = []; let invalidLines = 0;
  for (const line of lines.slice(0, 2049)) {
    let row; try { row = JSON.parse(line); } catch { invalidLines++; continue; }
    if (!valid(row)) { invalidLines++; continue; }
    events.push(row);
  }
  return { state: lines.length > 2049 ? "truncated" : "parsed", events, invalidLines, partialLastLine,
    singleProcessEpoch: new Set(events.map((e) => `${e.pid}:${e.epoch}`)).size === 1,
    contiguous: events.every((e, i) => e.seq === i), budgetReached: events.some((e) => e.k === 12) };
}

/** These are owned dispatch/lifecycle observations, never a direct callback or private-cause verdict. */
export function nativeModalSummary(parsed) {
  const windows = new Map();
  const events = parsed.singleProcessEpoch ? parsed.events : [];
  for (const e of events) {
    if (e.a === 0 || e.win === 0) continue;
    const id = `${e.a}:${e.win}`;
    if (!windows.has(id) && windows.size >= 128) continue;
    if (!windows.has(id)) windows.set(id, { alert: e.a, window: e.win, adoption: "unknown", hideEntered: false, hideReturned: false,
      callbackBoundary: "not-directly-observed", nativeCancellationOwner: "UNKNOWN", touches: [], touchRecordsTruncated: false, dispatches: new Map() });
    const w = windows.get(id);
    if ([4, 5].includes(e.k)) w.adoption = e.k === 4 && e.code === 0 ? "observed-owned-instance" : "unavailable";
    if (e.k === 9) w.hideEntered = true;
    if (e.k === 10) w.hideReturned = true;
    if (e.k === 6 && e.d > 0) {
      if (!w.dispatches.has(e.d)) w.dispatches.set(e.d, { first: e, returned: false, threw: false });
      if (w.touches.length < 32) w.touches.push({ q: e.q, dispatch: e.d, target: e.target, phase: e.phase ?? null, sequence: e.seq,
        sample: nativeTouchWindow(e), candidates: e.candidates ?? [], candidatesTruncated: e.candidatesTruncated === true });
      else w.touchRecordsTruncated = true;
    }
    if ([7, 8].includes(e.k) && w.dispatches.has(e.d)) {
      const dispatch = w.dispatches.get(e.d); dispatch.returned = e.k === 7; dispatch.threw = e.k === 8;
      dispatch.envelopeMs = Number.isFinite(e.u1) && Number.isFinite(dispatch.first.u0) && e.u1 >= dispatch.first.u0 ? (e.u1 - dispatch.first.u0) * 1000 : null;
    }
  }
  const installation = parsed.events.find((e) => e.k === 0);
  return { installed: installation?.code === 0 && installation?.hookCount === 3,
    coverage: parsed.state === "parsed" && parsed.invalidLines === 0 && parsed.singleProcessEpoch && parsed.contiguous
      && !parsed.partialLastLine && !parsed.budgetReached ? "retained-prefix" : "partial-or-unavailable",
    windows: [...windows.values()].map(({ dispatches, ...window }) => ({ ...window,
      dispatches: [...dispatches.entries()].map(([id, { returned, threw, envelopeMs }]) => ({ id, returned, threw, envelopeMs: envelopeMs ?? null })) })),
    directCallback: "unavailable-cxx-reference-abi", absenceProvesNothing: true };
}
