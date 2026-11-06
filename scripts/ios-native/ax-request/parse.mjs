const PREFIX = "HS_AX_STAGE_V1 ";
const keys = ["v", "seq", "pid", "request", "stage", "edge", "error", "target", "role", "wallUs", "monoUs"].sort();
const integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;
export function stageRow(row) {
  return row && typeof row === "object" && !Array.isArray(row) && JSON.stringify(Object.keys(row).sort()) === JSON.stringify(keys)
    && row.v === 1 && integer(row.seq, 0, 256) && integer(row.pid, 1, 1e9) && integer(row.request, 0, 64)
    && [1, 2, 3, 4, 7, 15].includes(row.stage) && integer(row.edge, 0, 2) && integer(row.error, 0, 4)
    && integer(row.target, 0, 1e9) && integer(row.role, 0, 3) && integer(row.wallUs, 0, 9e15) && integer(row.monoUs, 0, 9e15)
    && (row.role === 0 || row.target > 0) && (row.role !== 3 || row.target === row.pid);
}
export function parseStages(text) {
  const events = []; let invalid = 0, truncated = false;
  for (const line of text.split("\n")) {
    const at = line.indexOf(PREFIX); if (at < 0) continue;
    if (events.length === 257) { truncated = true; break; }
    if (line.length > 2048) { invalid++; continue; }
    try {
      const row = JSON.parse(line.slice(at + PREFIX.length));
      if (!stageRow(row)) { invalid++; continue; }
      events.push(row);
    } catch { invalid++; }
  }
  const sequences = new Map(); let contiguous = true;
  for (const row of events) {
    const expected = sequences.get(row.pid) ?? 0;
    if (row.seq !== expected) contiguous = false;
    sequences.set(row.pid, row.seq + 1);
  }
  return { events, invalid, contiguous, truncated: truncated || events.some((e) => e.stage === 15),
    limits: ["private-AX-operation-target-unavailable-until-returned-metadata", "XCTest-issue-callback-may-have-request-zero", "not-wire-response-or-historical-cause-proof"] };
}
export function requestCapability(parsed) {
  const retained = [];
  if (parsed.invalid || !parsed.contiguous || parsed.truncated) return { status: "unavailable", retained };
  const identities = new Set(parsed.events.filter((e) => e.request > 0).map((e) => `${e.pid}:${e.request}`));
  for (const identity of identities) {
    const rows = parsed.events.filter((e) => `${e.pid}:${e.request}` === identity);
    const first = rows[0], axBegin = rows.find((e) => e.stage === 2 && e.edge === 0);
    const axEnd = rows.find((e) => e.stage === 2 && e.edge === 1);
    const owned = rows.find((e) => e.stage === 3 && e.edge === 1 && e.role === 1);
    const response = rows.find((e) => e.stage === 7 && e.edge === 1);
    const last = rows.at(-1);
    if (first.stage !== 1 || first.edge !== 0 || !axBegin || !axEnd || !owned || !response || last.stage !== 1 || last.edge !== 1) continue;
    if (!(first.seq < axBegin.seq && axBegin.seq < axEnd.seq && axEnd.seq < owned.seq && owned.seq < response.seq && response.seq < last.seq)) continue;
    if (rows.some((e) => e.edge === 2 || e.error !== 0)) continue;
    if (rows.some((e, i) => i > 0 && e.monoUs < rows[i - 1].monoUs)) continue;
    retained.push({ pid: first.pid, request: first.request, ownedTargetPid: owned.target,
      querySampleUs: axEnd.monoUs - axBegin.monoUs, handlerSampleUs: last.monoUs - first.monoUs });
  }
  return { status: retained.length ? "observed" : "unavailable", retained };
}

/** Build diagnostics are finite locations/classes, never compiler or AX payload text. */
export function compilerSummary(text) {
  const names = ["AXClientProxy.m", "DeviceInfoHandler.swift", "maestro_driver_iosUITests.swift"];
  const locations = [];
  for (const line of text.split("\n")) {
    const match = line.match(/([^/\\:]+):(\d+):(\d+): error: (.*)$/);
    if (!match) continue;
    if (locations.length === 16) break;
    const file = names.indexOf(match[1]) + 1;
    const kind = /cannot find|undeclared identifier/.test(match[4]) ? 1 : /no member/.test(match[4]) ? 2 : /unknown type/.test(match[4]) ? 3 : 0;
    const lineNumber = Number(match[2]), column = Number(match[3]);
    if (integer(lineNumber, 1, 1e6) && integer(column, 1, 1e6)) locations.push({ file, line: lineNumber, column, kind });
  }
  return { locations, packageResolutionFailed: text.includes("Could not resolve package dependencies"),
    destinationUnavailable: text.includes("Unable to find a destination"), payloadRetained: false };
}
