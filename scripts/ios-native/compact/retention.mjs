import { basename, join } from "node:path";
import { writeFileSync } from "node:fs";

const prefix = "THIRDROLL_COMPACT ";
const integer = (n, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= min && n <= max;
const sha = s => typeof s === "string" && /^[a-f0-9]{40}$/.test(s);
const numeric = s => typeof s === "string" && /^[1-9][0-9]{0,19}$/.test(s);
const common = ["v", "pid", "source", "run", "attempt", "invoke", "flow", "route", "rpc", "seq", "stage", "monoUs"];
const details = {
  0: ["phase"],
  1: ["node", "parent", "outputParent", "depth", "rawHelp", "outputHelp", "kind", "reason", "post", "enabled", "rect"],
  2: ["query", "formatter", "handler", "visited", "kept", "zero", "empty", "preHelp", "preTarget", "postHelp", "postTarget", "partial", "facts", "queryBeginUs", "queryEndUs", "formatBeginUs", "formatEndUs"],
};

/** Bind only the authored corruption/reset scope and current source/run. */
export function compactEnvironment(env, name, source) {
  if (!["reset-document", "reset-database"].includes(name) || !sha(source) || !numeric(env.GITHUB_RUN_ID) || !numeric(env.GITHUB_RUN_ATTEMPT)) return env;
  return { ...env, THIRDROLL_COMPACT_SOURCE: source, THIRDROLL_COMPACT_RUN: env.GITHUB_RUN_ID,
    THIRDROLL_COMPACT_ATTEMPT: env.GITHUB_RUN_ATTEMPT, THIRDROLL_COMPACT_ROUTE: name === "reset-document" ? "1" : "2" };
}

export function compactChildEnvironment(env, phase, directory) {
  const route = { "reset-document": "1", "reset-database": "2" }[basename(directory)];
  if (phase !== "reset" || !route || env.THIRDROLL_COMPACT_ROUTE !== route || !sha(env.THIRDROLL_COMPACT_SOURCE) ||
      !numeric(env.GITHUB_RUN_ID) || !numeric(env.GITHUB_RUN_ATTEMPT) || env.THIRDROLL_COMPACT_RUN !== env.GITHUB_RUN_ID ||
      env.THIRDROLL_COMPACT_ATTEMPT !== env.GITHUB_RUN_ATTEMPT) return {};
  return Object.fromEntries(["THIRDROLL_COMPACT_SOURCE", "THIRDROLL_COMPACT_RUN", "THIRDROLL_COMPACT_ATTEMPT", "THIRDROLL_COMPACT_ROUTE"].map(k => [k, env[k]]));
}

export function compactRequest(identity, invoke, flow) {
  if (!sha(identity.THIRDROLL_COMPACT_SOURCE) || !numeric(identity.THIRDROLL_COMPACT_RUN) || !numeric(identity.THIRDROLL_COMPACT_ATTEMPT) ||
      !["1", "2"].includes(identity.THIRDROLL_COMPACT_ROUTE) || !integer(invoke, 1, 36) || !integer(flow, 0, 128)) return undefined;
  return { v: 1, invoke, flow, route: Number(identity.THIRDROLL_COMPACT_ROUTE) };
}

/** The original JSON-RPC id is allocated once, before this same original send. */
export function bindCompactRequest(method, params, observation, id) {
  try {
  if (method !== "tools/call" || params?.name !== "inspect_screen" || !observation ||
      Object.keys(observation).sort().join() !== "flow,invoke,route,v" || observation.v !== 1 ||
      !integer(observation.invoke, 1, 36) || !integer(observation.flow, 0, 128) || !integer(observation.route, 1, 2) || !integer(id, 1, 1000000)) return params;
  return { ...params, _meta: { "dev.hemsoft/compact": { ...observation, rpc: id } } };
  } catch { return params; }
}

function valid(row, identity) {
  if (!row || !details[row.stage] || Object.keys(row).sort().join() !== [...common, ...details[row.stage]].sort().join() ||
      row.v !== 1 || row.source !== identity.THIRDROLL_COMPACT_SOURCE || row.run !== identity.THIRDROLL_COMPACT_RUN ||
      row.attempt !== identity.THIRDROLL_COMPACT_ATTEMPT || row.route !== Number(identity.THIRDROLL_COMPACT_ROUTE) ||
      !sha(row.source) || !numeric(row.run) || !numeric(row.attempt) || !integer(row.pid, 1) || !integer(row.invoke, 1, 36) ||
      !integer(row.flow, 0, 128) || !integer(row.rpc, 1, 1000000) || !integer(row.seq, 0, 11) ||
      !(row.monoUs === null || integer(row.monoUs))) return false;
  if (row.stage === 0) return row.phase === 0 && row.seq === 0;
  if (row.stage === 1) return integer(row.node, 1, 512) && integer(row.parent, 0, row.node - 1) &&
    integer(row.outputParent, 0, row.node - 1) && integer(row.depth, 0, 24) && integer(row.rawHelp, 0, row.node) &&
    integer(row.outputHelp, 0, row.node - 1) && integer(row.kind, 1, 7) && integer(row.reason, -1, 2) &&
    integer(row.post, 0, 7) && integer(row.enabled, -1, 1) && (row.rect === null ||
      Array.isArray(row.rect) && row.rect.length === 4 && row.rect.every(x => integer(x, -1000000, 1000000)));
  return ["query", "formatter", "handler"].every(k => integer(row[k], 0, 3)) &&
    ["visited", "kept", "zero", "empty", "preHelp", "preTarget", "postHelp", "postTarget"].every(k => integer(row[k], 0, 512)) &&
    row.kept + row.zero + row.empty <= row.visited && row.postHelp <= row.preHelp && row.postTarget <= row.preTarget &&
    integer(row.partial, 0, 4) && integer(row.facts, 0, 8) &&
    ["queryBeginUs", "queryEndUs", "formatBeginUs", "formatEndUs"].every(k => row[k] === null || integer(row[k]));
}

/** Streaming allowlist before any observation payload is persisted. No tree is parsed. */
export function compactCollector(identity, ordinary = () => {}) {
  let mode = "prefix", buffer = "", bytes = 0, partial = false, invalid = 0, finished = false;
  const records = [], contexts = new Map();
  function consume(line) {
    if (records.length >= 432 || bytes + Buffer.byteLength(line) + prefix.length + 1 > 160 * 1024) { partial = true; return; }
    try {
      const row = JSON.parse(line);
      if (!valid(row, identity)) throw new Error();
      const key = `${row.pid}:${row.invoke}`, context = contexts.get(key);
      if (!context) {
        if (row.stage !== 0 || contexts.size >= 36) throw new Error();
        contexts.set(key, { next: 1, facts: 0, closed: false, flow: row.flow, rpc: row.rpc, nodes: new Set() });
      } else {
        if (context.closed || row.seq !== context.next || row.stage === 0 || row.flow !== context.flow || row.rpc !== context.rpc) throw new Error();
        if (row.stage === 1) {
          if (context.nodes.has(row.node) || context.facts >= 8) throw new Error();
          context.nodes.add(row.node); context.facts++;
        } else {
          context.closed = true;
          if (context.facts !== row.facts || row.partial || row.query !== 2 || row.formatter !== 2 || row.handler !== 2) partial = true;
        }
        context.next++;
      }
      if (row.monoUs === null) partial = true;
      bytes += Buffer.byteLength(line) + prefix.length + 1;
      records.push(row);
    } catch { partial = true; invalid++; }
  }
  function feed(text) {
    if (finished) return;
    try {
      if (typeof text !== "string") { partial = true; return; }
      for (let start = 0; start < text.length;) {
        if (mode === "ordinary") {
          const end = text.indexOf("\n", start);
          if (end === -1) { ordinary(text.slice(start)); break; }
          ordinary(text.slice(start, end + 1)); start = end + 1; mode = "prefix";
        } else if (mode === "drop") {
          const end = text.indexOf("\n", start);
          if (end === -1) break;
          start = end + 1; mode = "prefix";
        } else {
          const character = text[start++];
          if (mode === "prefix") {
            buffer += character;
            if (!prefix.startsWith(buffer)) { ordinary(buffer); buffer = ""; mode = character === "\n" ? "prefix" : "ordinary"; }
            else if (buffer === prefix) { buffer = ""; mode = "record"; }
          } else if (character === "\n") { consume(buffer); buffer = ""; mode = "prefix"; }
          else {
            buffer += character;
            if (Buffer.byteLength(buffer) + prefix.length + 1 > 1024) { partial = true; invalid++; buffer = ""; mode = "drop"; }
          }
        }
      }
    } catch { partial = true; buffer = ""; mode = "drop"; }
  }
  function result() {
    const open = [...contexts.values()].some(c => !c.closed);
    return { v: 1, status: !records.length ? "unavailable" : partial || open ? "partial" : "observed", records,
      invalid, retainedBytes: bytes, coverage: "retained-prefix", absenceProvesNothing: true,
      upstreamBoundary: "returned-Maestro-viewHierarchy-after-existing-out-of-bounds-filter",
      callbackClocks: "same-JVM-monotonic-only", geometryTime: "formatter-walk-not-AX-or-paint", loadedImage: "unattested", timingPerturbed: true };
  }
  function retain(directory, writer = writeFileSync, attempt = 1) {
    if (finished) return result();
    finished = true;
    if (buffer || mode === "record" || mode === "drop") partial = true;
    const value = result();
    try {
      if (!integer(attempt, 1, 2)) throw new Error();
      writer(join(directory, `reset-compact-results-${attempt}.json`), JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
    }
    catch { value.status = "unavailable"; value.retention = "unavailable"; }
    return value;
  }
  return { feed, retain };
}
