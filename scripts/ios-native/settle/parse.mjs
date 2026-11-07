const prefix = "THIRDROLL_SETTLE ";
const keys = ["id", "monoNs", "phase", "pid", "seq", "stage", "v", "wallMs"];
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;

function valid(row) {
  if (!row || typeof row !== "object" || Array.isArray(row) || ![1, 2, 3, 4].includes(row.v)) return false;
  const expected = row.v === 1 ? keys : [...keys, "parentId", ...(row.v === 4 ? ["cpuNs"] : [])].sort();
  const parent = row.v === 1 || (row.stage <= 2 ? row.parentId === 0 : integer(row.parentId, 1, row.id - 1));
  const cpu = row.v !== 4 || row.cpuNs === null || (row.stage === 6 && integer(row.cpuNs, 0));
  return Object.keys(row).sort().join() === expected.join() && parent && cpu &&
    integer(row.seq, 0, 255) && integer(row.id, 1, 128) && integer(row.stage, 1, row.v === 1 ? 2 : row.v === 2 ? 4 : 6) &&
    integer(row.phase, 0, 2) && integer(row.monoNs, 0) && integer(row.pid, 1) && integer(row.wallMs, 1);
}

/** A daemon writer may lose its suffix at exit. Even a contiguous prefix proves no absence. */
export function parseStages(text) {
  const unavailable = { status: "unavailable", coverage: "retained-prefix", absenceProvesNothing: true, events: [], pairs: [] };
  if (typeof text !== "string" || Buffer.byteLength(text) > 512 * 1024) return unavailable;
  const events = []; let invalid = 0, truncated = false;
  for (const line of text.split("\n")) {
    if (!line.startsWith(prefix)) continue;
    if (events.length >= 256) { truncated = true; continue; }
    try {
      if (line.length > 2048) throw new Error();
      const event = JSON.parse(line.slice(prefix.length));
      if (!valid(event)) throw new Error();
      const fields = event.v === 1 ? keys : [...keys, "parentId", ...(event.v === 4 ? ["cpuNs"] : [])];
      events.push(Object.fromEntries(fields.map((key) => [key, event[key]])));
    } catch { invalid++; }
  }
  const groups = new Map();
  for (const event of events) {
    const key = `${event.v}:${event.pid}:${event.id}`;
    const group = groups.get(key) ?? []; group.push(event); groups.set(key, group);
  }
  const pairs = [];
  for (const rows of groups.values()) {
    const [begin, end] = rows;
    if (rows.length !== 2 || begin.phase !== 0 || ![1, 2].includes(end.phase) || begin.stage !== end.stage || begin.parentId !== end.parentId ||
      begin.seq >= end.seq || begin.monoNs > end.monoNs) continue;
    pairs.push({ version: begin.v, id: begin.id, parentId: begin.parentId ?? null, pid: begin.pid, stage: begin.stage, beginSequence: begin.seq, endSequence: end.seq,
      beginMonotonicNs: begin.monoNs, endMonotonicNs: end.monoNs,
      durationMs: (end.monoNs - begin.monoNs) / 1e6, beginWallMs: begin.wallMs, endWallMs: end.wallMs,
      cpuDurationMs: begin.v === 4 && begin.stage === 6 && begin.cpuNs !== null && end.cpuNs !== null && end.cpuNs >= begin.cpuNs ? (end.cpuNs - begin.cpuNs) / 1e6 : null,
      outcome: end.phase === 1 ? "returned" : "threw", errorClass: end.phase === 2 ? "unknown" : null });
  }
  const contiguous = events.length > 0 && events[0].seq === 0 && events.every((event, index) => index === 0 || event.seq === events[index - 1].seq + 1);
  return { status: pairs.length ? "observed" : events.length ? "partial" : "unavailable", coverage: "retained-prefix",
    absenceProvesNothing: true, invalid, contiguous, budgetReached: truncated || events.some((event) => event.seq === 255),
    multipleProcesses: new Set(events.map((event) => event.pid)).size > 1, events, pairs };
}

/** Classify only the original one-command search flows, retaining no YAML or coordinates. */
export function searchCommand(text) {
  if (typeof text !== "string" || text.length > 262144) return 0;
  const lines = text.trim().split("\n");
  if (lines.length !== 3 || lines[0] !== 'appId: "com.hemsoft.thirdroll"' || lines[1] !== "---") return 0;
  if (lines[2] === '- waitForAnimationToEnd: {"timeout":5000}') return 1;
  if (!lines[2].startsWith("- swipe: ")) return 0;
  try {
    const command = JSON.parse(lines[2].slice(9));
    return Object.keys(command).sort().join() === "duration,end,start" && command.duration === 600 &&
      [command.start, command.end].every((point) => typeof point === "string" && /^\d{1,5},\d{1,5}$/.test(point)) ? 2 : 0;
  } catch { return 0; }
}

/** Wall-clock correspondence is conditional, never an attestation or a fabricated parent ID. */
export function correlateStages(parsed, calls, classifications) {
  if (!Array.isArray(calls) || calls.length > 2048) return [];
  const requests = calls.filter((call) => call?.tool === "run" && integer(call.flowSequence, 1, 2048) &&
    integer(call.started, 1) && Number.isFinite(call.elapsedMs) && call.elapsedMs >= 0 && call.elapsedMs <= 1200000 &&
    ["returned", "threw"].includes(call.outcome) && [1, 2].includes(classifications[call.flowSequence]));
  const outer = parsed.pairs.filter((pair) => pair.stage <= 2).map((pair) => {
    const matches = requests.filter((call) => classifications[call.flowSequence] === pair.stage &&
      pair.beginWallMs <= pair.endWallMs && pair.durationMs <= call.elapsedMs && call.started <= pair.beginWallMs && pair.endWallMs <= call.started + call.elapsedMs);
    const match = matches.length === 1 ? matches[0] : null;
    return { ...pair, correspondence: match ? "conditional-local-wall" : "unknown", flowSequence: match?.flowSequence ?? null,
      originalRequestMs: match?.elapsedMs ?? null, originalRequestOutcome: match?.outcome ?? null,
      requestResultIsNotAssertionAcceptance: true };
  });
  const inner = parsed.pairs.filter((pair) => pair.stage > 2).map((pair) => {
    const parent = outer.find((candidate) => candidate.version === pair.version && pair.version >= 2 && candidate.pid === pair.pid && candidate.id === pair.parentId &&
      candidate.stage === (pair.stage === 4 ? 2 : 1) && candidate.beginSequence < pair.beginSequence && pair.endSequence < candidate.endSequence &&
      candidate.beginMonotonicNs <= pair.beginMonotonicNs && pair.endMonotonicNs <= candidate.endMonotonicNs);
    return { ...pair, parentCorrelation: parent ? "same-thread-source-scope" : "unknown",
      correspondence: parent?.correspondence ?? "unknown", flowSequence: parent?.flowSequence ?? null,
      originalRequestMs: parent?.originalRequestMs ?? null, originalRequestOutcome: parent?.originalRequestOutcome ?? null,
      requestResultIsNotAssertionAcceptance: true };
  });
  return [...outer, ...inner];
}
