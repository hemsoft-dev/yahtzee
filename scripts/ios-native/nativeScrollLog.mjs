const BASE = ["v", "seq", "pid", "epoch", "k", "phase", "call", "instance", "window", "gesture", "q", "code", "u0", "u1", "w", "willDecelerate", "metrics", "touch"];
const COORDS = ["ox", "oy", "bx", "by", "bw", "bh", "cw", "ch", "it", "il", "ib", "ir", "at", "al", "ab", "ar", "fx", "fy", "fw", "fh", "cx", "cy", "cwidth", "cheight", "zoom", "ww", "wh", "scale"];
const FLAGS = ["geometryComplete", "drag", "decel", "tracking", "enabled", "clips", "hidden", "attached"];
const integer = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const finite = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === [...keys].sort().join();
const metricValid = (v) => v === null || exact(v, [...COORDS, ...FLAGS, "orientation"]) && COORDS.every((k) => v[k] === null || integer(v[k], -1e9, 1e9)) && FLAGS.every((k) => typeof v[k] === "boolean") && integer(v.orientation, 0, 4);
const touchValid = (v) => v === null || exact(v, ["tt", "phase", "x", "y", "sx", "sy"]) && finite(v.tt, 0, 1e12) && integer(v.phase, 0, 7) && ["x", "y", "sx", "sy"].every((k) => v[k] === null || integer(v[k], -1e9, 1e9));
const BOUNDS = { seq: [0, 2048], pid: [1, 1e9], epoch: [1, 1e15], k: [0, 14], phase: [0, 3], call: [0, 2048], instance: [0, 8], window: [0, 16], gesture: [0, 2048], q: [0, 2048], code: [0, 8], willDecelerate: [-1, 1] };

function headerValid(e) {
  return exact(e, BASE) && e.v === 1 && Object.entries(BOUNDS).every(([k, limits]) => integer(e[k], ...limits)) &&
    [e.u0, e.u1, e.w].every((v) => finite(v, 0, 1e12)) && metricValid(e.metrics) && touchValid(e.touch);
}
function callbackShape(e) {
  return e.phase <= 2 && e.call > 0 && e.instance > 0 && e.q === 0 && e.touch === null && (e.k === 8 ? e.willDecelerate >= 0 : e.willDecelerate === -1);
}

function valid(e) {
  if (!headerValid(e)) return false;
  if (e.k >= 6 && e.k <= 12) return callbackShape(e);
  if (e.phase !== 3 || e.call !== 0 || e.willDecelerate !== -1) return false;
  if (e.k >= 1 && e.k <= 5) return e.instance > 0 && (e.k === 1 ? e.q === 0 && e.touch === null : true);
  return [0, 13, 14].includes(e.k) && e.instance === 0 && e.window === 0 && e.gesture === 0 && e.q === 0 && e.metrics === null && e.touch === null && (e.k !== 14 || e.seq === 2048);
}

/** Strict finite prefixes only. No raw invalid value or native name is retained. */
export function parseNativeScroll(text) {
  const unavailable = { status: "unavailable", events: [], absenceProvesNothing: true };
  if (typeof text !== "string" || Buffer.byteLength(text) > 4 * 1024 * 1024) return unavailable;
  const lines = text.split("\n"), partialLastLine = lines.pop() !== "", events = [];
  let invalidLines = 0;
  for (const line of lines.slice(0, 2049)) {
    try { const e = JSON.parse(line); if (line.length > 8192 || !valid(e)) throw new Error(); events.push(e); }
    catch { invalidLines++; }
  }
  return { status: lines.length > 2049 ? "truncated" : "parsed", events, invalidLines, partialLastLine,
    singleProcessEpoch: new Set(events.map((e) => `${e.pid}:${e.epoch}`)).size === 1,
    contiguous: events.every((e, i) => e.seq === i), budgetReached: events.some((e) => e.k === 14), absenceProvesNothing: true };
}

export function scrollTouchWindow(e) {
  const t = e.touch;
  if (!t || ![e.u0, e.u1, e.w, t.tt].every(Number.isFinite) || e.u0 > e.u1 || e.u1 - e.u0 > 1 || t.tt < e.u0 - 30 || t.tt > e.u1) return null;
  return { conditionalWallStartMs: (e.w + t.tt - e.u1) * 1000, conditionalWallEndMs: (e.w + t.tt - e.u0) * 1000 };
}

/** Nominal geometric extent, not an assertion that UIKit clamps or has settled. */
export function scrollRange(metrics) {
  if (!metrics || !["ch", "bh", "at", "ab", "oy"].every((k) => Number.isSafeInteger(metrics[k])) || metrics.ch < 0 || metrics.bh <= 0 || metrics.zoom !== 1000) return null;
  const minimum = -metrics.at, maximum = Math.max(minimum, metrics.ch - metrics.bh + metrics.ab);
  return { minimumMillipoints: minimum, maximumMillipoints: maximum, offsetMillipoints: metrics.oy, elasticOrOutsideNominalRange: metrics.oy < minimum || metrics.oy > maximum };
}

function callbackCompletions(events) {
  const groups = new Map(), completions = [];
  for (const e of events) {
    if (e.k < 6 || e.k > 12 || !e.call) continue;
    const rows = groups.get(e.call) ?? []; rows.push(e); groups.set(e.call, rows);
  }
  for (const rows of groups.values()) {
    const [begin, end] = rows;
    if (rows.length !== 2 || begin.phase !== 0 || ![1, 2].includes(end.phase) || begin.k !== end.k || begin.instance !== end.instance || begin.seq >= end.seq || begin.u0 > end.u0) continue;
    completions.push({ pid: end.pid, epoch: end.epoch, instance: end.instance, kind: end.k, call: end.call,
      beginSequence: begin.seq, endSequence: end.seq, beginWindow: begin.window, endWindow: end.window,
      ownership: begin.code === 0 && end.code === 0 ? "verified-help-pair" : "unknown",
      outcome: end.phase === 1 ? "returned" : "threw-unknown", range: begin.code === 0 && end.code === 0 ? scrollRange(end.metrics) : null, futureStabilityProved: false });
  }
  return completions;
}

export function nativeScrollSummary(parsed) {
  const events = parsed.singleProcessEpoch ? parsed.events : [], previous = new Map(), movement = [];
  let movementCount = 0;
  for (const e of events) {
    if (e.code !== 0 || !e.instance || !e.window || !e.metrics || !Number.isSafeInteger(e.metrics.oy)) continue;
    const key = `${e.instance}:${e.window}`, prior = previous.get(key);
    if (prior && prior.u0 <= e.u0 && prior.metrics.oy !== e.metrics.oy) {
      movementCount++;
      if (movement.length < 64) movement.push({ instance: e.instance, window: e.window, fromSequence: prior.seq, toSequence: e.seq, deltaMillipoints: e.metrics.oy - prior.metrics.oy });
    }
    previous.set(key, e);
  }
  const allCompletions = callbackCompletions(events), completions = allCompletions.slice(0, 64);
  return { installationPrepared: events.some((e) => e.k === 0 && e.code === 0), ownedInstancesObserved: [...new Set(events.filter((e) => e.k === 1 && e.code === 0).map((e) => e.instance))],
    completions, completionsTruncated: allCompletions.length > 64, movement, movementTruncated: movementCount > 64,
    coverage: "retained-prefix", absenceProvesNothing: true, limits: ["returned-callback-not-paint-AX-or-future-stability", "offset-change-not-input-cause", "nominal-range-allows-elastic-overscroll", "conditional-clocks", "owner-and-cancellation-reason-not-inferred"] };
}
