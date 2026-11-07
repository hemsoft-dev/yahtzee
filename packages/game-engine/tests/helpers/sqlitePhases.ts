/** Test-only finite phases. No timer, SQL text, path, saved data or error payload. */
export function sqlitePhases(emit: (value: object) => void, now = () => performance.now()) {
  const records: { sequence: number; kind: number; phase: number; edge: number; atUs: number }[] = [];
  let phase = 0, origin: number | undefined, clockUnavailable = false, truncated = false, finished = false;
  const record = (kind: number, edge: number) => {
    try {
      if (finished) return;
      if (records.length === 256) { truncated = true; return; }
      const time = now(); origin ??= time;
      const atUs = Math.round((time - origin) * 1000);
      if (!Number.isFinite(atUs) || atUs < 0 || atUs > 1e12) { clockUnavailable = true; return; }
      records.push({ sequence: records.length, kind, phase, edge, atUs });
    } catch { clockUnavailable = true; }
  };
  return {
    phase(value: number) { if (Number.isInteger(value) && value >= 1 && value <= 11) { phase = value; record(0, 0); } },
    call<T>(kind: 1 | 2 | 3 | 4 | 5, action: () => T): T {
      record(kind, 0); let returned = false;
      try { const result = action(); returned = true; return result; }
      finally { record(kind, returned ? 1 : 2); }
    },
    finish() {
      if (finished) return; finished = true;
      try { emit({ schemaVersion: 1, test: 1, records: records.slice(), truncated, clockUnavailable }); } catch { /* Cannot replace test/cleanup outcomes. */ }
    },
  };
}
