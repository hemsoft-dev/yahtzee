// Test-only finite recorder. No CDP params, results, selectors or error text enter it.
const METHODS = new Map([
  ["Input.dispatchMouseEvent", 1], ["Runtime.callFunctionOn", 2],
  ["Runtime.evaluate", 3], ["Runtime.releaseObject", 4],
]);
export const LIMIT = 256;
export function createRecorder(write, clock = () => performance.now()) {
  let active = false, sequence = 0, origin = 0, previous = 0;
  let partial = false, exhausted = false;
  const pending = new Map();
  const connections = new Map();
  function connectionId(connection) {
    if (!connections.has(connection)) {
      if (connections.size === LIMIT) { partial = true; exhausted = true; return 0; }
      connections.set(connection, connections.size + 1);
    }
    return connections.get(connection);
  }
  function stamp() {
    try {
      const value = Math.floor((clock() - origin) * 1000);
      if (Number.isSafeInteger(value) && value >= previous && value >= 0) return previous = value;
    } catch { /* Observation must not escape into Playwright. */ }
    partial = true; return previous;
  }
  function edge(stage, edge, method = 0, id = 0, connection = 0) {
    if (!active) return;
    if (![1, 2, 4, 5, 6, 7, 8].includes(stage) || ![0, 1, 2].includes(edge)
      || !Number.isInteger(method) || method < 0 || method > 4
      || !Number.isSafeInteger(id) || id < 0
      || !Number.isInteger(connection) || connection < 0 || connection > LIMIT) { partial = true; return; }
    if (sequence === LIMIT) { exhausted = true; partial = true; return; }
    const row = { v: 1, sequence: sequence++, request: 1, stage, edge, method, id, connection, monoUs: stamp() };
    try { write(row); } catch { partial = true; }
  }
  return Object.freeze({
    begin() {
      if (active || sequence) { partial = true; return; }
      try { origin = clock(); if (!Number.isFinite(origin)) throw 0; }
      catch { origin = 0; partial = true; }
      active = true; edge(1, 0);
    },
    edge,
    send(id, method, connection) {
      if (!active || !Number.isSafeInteger(id) || id <= 0) return;
      if (pending.size === LIMIT) { exhausted = true; partial = true; return; }
      const kind = METHODS.get(method) ?? 0;
      const owner = connectionId(connection);
      if (!owner) return;
      pending.set(owner + ":" + id, kind); edge(4, 0, kind, id, owner);
    },
    receive(id, failed, connection) {
      if (!active || !connections.has(connection)) return;
      const owner = connections.get(connection), key = owner + ":" + id;
      if (!pending.has(key)) return;
      const kind = pending.get(key); pending.delete(key);
      edge(4, failed ? 2 : 1, kind, id, owner);
    },
    complete(failed) { edge(1, failed ? 2 : 1); active = false; },
    state() { return { active, partial: partial || active || pending.size > 0 || connections.size > 1, exhausted, rows: sequence, pending: pending.size, connections: connections.size }; },
  });
}
