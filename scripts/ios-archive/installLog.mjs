// Source-mapped marker observations, never package/error payload retention.
const MAX = 1_000_000_000;
const CSI = new RegExp(String.fromCharCode(27) + "\\[[0-?]*[ -/]*[@-~]", "g");
export const INSTALL_LIMITS = Object.freeze({ bytes: 4 * 1024 * 1024, line: 512, events: 64 });
const add = (a, b = 1) => Math.min(MAX, a + b);
export function installMarker(line) {
  line = line.replace(CSI, "").trimEnd();
  if (line === "bun install v1.4.2 (744846f84)") return { stage: 1, count: null };
  if (line === "Resolving dependencies") return { stage: 2, count: null };
  const resolution = /^Resolved, downloaded and extracted \[([0-9]{1,7})\]$/.exec(line);
  if (resolution) return { stage: 3, count: Number(resolution[1]) };
  const store = /^(Resolved peers|Created store) \[([^\]]{1,24})\]$/.exec(line);
  // Pinned fmt_duration_one_decimal uses ordered coarse units then at most
  // one fine unit. Duration text is validated and discarded, never retained.
  const duration = /^(?=.{1,24}$)(?:[1-9][0-9]{0,2}y)?(?:[1-9][0-9]?w)?(?:[1-9][0-9]?d)?(?:[1-9][0-9]?h)?(?:[1-9][0-9]?m)?(?:(?:[1-9][0-9]{0,2})(?:\.[1-9])?(?:s|ms|us)|(?:0|[1-9][0-9]{0,2})ns)?$/;
  if (store && duration.test(store[2])) return { stage: store[1] === "Resolved peers" ? 4 : 5, count: null };
  const pending = /^\[PackageManager\] waiting for ([0-9]{1,7}) tasks$/.exec(line);
  return pending ? { stage: 6, count: Number(pending[1]) } : null;
}
const valid = (m) => m && Object.keys(m).sort().join() === "count,stage" && Number.isSafeInteger(m.stage) && m.stage >= 1 && m.stage <= 6
  && (m.count === null || Number.isSafeInteger(m.count) && m.count >= 0 && m.count <= 9_999_999);
export function installCollector({ emit = () => {}, classify = installMarker, clock = () => performance.now() } = {}) {
  const buffers = [[], []], discarding = [false, false];
  const stats = { bytes: 0, parsedBytes: 0, lines: 0, unknown: 0, oversized: 0, partialLines: 0, classifierErrors: 0, sinkErrors: 0, eventLimit: false, byteLimit: false };
  let sequence = 0, ended = false;
  const time = () => { try { const n = Math.round(clock() * 1000); return Number.isSafeInteger(n) && n >= 0 ? n : null; } catch { return null; } };
  function line(stream) {
    stats.lines = add(stats.lines);
    if (discarding[stream]) { discarding[stream] = false; buffers[stream] = []; return; }
    const value = Buffer.from(buffers[stream]).toString("utf8").replace(/\r$/, ""); buffers[stream] = [];
    let marker;
    try { marker = classify(value); } catch { stats.classifierErrors = add(stats.classifierErrors); return; }
    if (!valid(marker)) { stats.unknown = add(stats.unknown); return; }
    if (sequence === INSTALL_LIMITS.events) { stats.eventLimit = true; return; }
    const row = { v: 1, kind: 1, seq: sequence++, stream: stream + 1, stage: marker.stage, count: marker.count, monoUs: time() };
    try { emit(row); } catch { stats.sinkErrors = add(stats.sinkErrors); }
  }
  return {
    push(stream, chunk) {
      if (ended || stream !== 1 && stream !== 2) return;
      try {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); stats.bytes = add(stats.bytes, bytes.length);
        const available = Math.min(bytes.length, INSTALL_LIMITS.bytes - stats.parsedBytes);
        if (available !== bytes.length) stats.byteLimit = true;
        for (let i = 0; i < available; i++) {
          const at = stream - 1, byte = bytes[i];
          if (byte === 10) line(at);
          else if (!discarding[at]) {
            if (buffers[at].length === INSTALL_LIMITS.line) { buffers[at] = []; discarding[at] = true; stats.oversized = add(stats.oversized); }
            else buffers[at].push(byte);
          }
        }
        stats.parsedBytes += available;
      } catch { stats.classifierErrors = add(stats.classifierErrors); }
    },
    finish() {
      if (!ended) { stats.partialLines = buffers.filter((b, i) => b.length || discarding[i]).length; buffers[0] = []; buffers[1] = []; ended = true; }
      return { ...stats, events: sequence, partial: stats.byteLimit || stats.eventLimit || stats.oversized > 0 || stats.partialLines > 0 || stats.classifierErrors > 0 || stats.sinkErrors > 0 };
    },
  };
}
