import { closeSync, openSync, readSync, existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

export function redactDriverLog(text, env) {
  let result = text.replace(/(authorization:\s*bearer\s+)\S+/gi, "$1<REDACTED>");
  for (const [name, value] of Object.entries(env)) {
    if (/(token|password|secret|credential|private.*key)/i.test(name) && typeof value === "string" && value.length >= 8) result = result.split(value).join("<REDACTED>");
  }
  return result;
}
/** Retain only the known driver log, not an entire hidden directory or its links. */
export function retainDriverLogs(debug, destination, name, env) {
  const tests = join(debug, ".maestro/tests");
  if (!existsSync(tests) || !lstatSync(tests).isDirectory()) return;
  let index = 0;
  for (const entry of readdirSync(tests, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = join(tests, entry.name, "maestro.log");
    if (!existsSync(source) || !lstatSync(source).isFile()) continue;
    writeFileSync(join(destination, `${name}-driver-${index++}.log`), redactDriverLog(readFileSync(source, "utf8"), env));
  }
}

const XCTEST_LOG_BYTES = 512 * 1024, EARLY_BYTES = 128 * 1024;
const OMITTED = "[XCTest middle omitted; see companion coverage.json for window boundaries]\n";

function plainDirectory(path) {
  return existsSync(path) && lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink();
}

/** Complete lines only, both before redaction and after its possible expansion. */
function window(fd, size, start, length, limit, env) {
  const bytes = Buffer.alloc(length);
  const count = readSync(fd, bytes, 0, length, start);
  let first = 0, end = count;
  // Read one preceding byte so an exact line boundary does not discard a line.
  if (start > 0) { const previous = Buffer.alloc(1); readSync(fd, previous, 0, 1, start - 1); if (previous[0] !== 10) first = bytes.indexOf(10) + 1 || count; }
  end = bytes.lastIndexOf(10, end - 1) + 1;
  if (end < first) end = first;
  let text = redactDriverLog(bytes.subarray(first, end).toString("utf8"), env);
  if (Buffer.byteLength(text) > limit) {
    const redacted = Buffer.from(text);
    if (start === 0) {
      const last = redacted.lastIndexOf(10, limit - 1); text = last < 0 ? "" : redacted.subarray(0, last + 1).toString("utf8");
    } else {
      const cut = redacted.indexOf(10, redacted.length - limit); text = cut < 0 ? "" : redacted.subarray(cut + 1).toString("utf8");
    }
  }
  return { text, sourceStart: start + first, sourceEnd: start + end, redactedBytes: Buffer.byteLength(text), postRedactionTruncated: Buffer.byteLength(redactDriverLog(bytes.subarray(first, end).toString("utf8"), env)) > limit, sourceBytesAtRead: size };
}

/** Only this phase's isolated XCTest logs; bounded complete lines, no symlinks. */
export function retainXCTestLogs(state, destination, prefix, env) {
  if (!/^(complete|hold|scenario|reset)$/.test(prefix)) throw new Error("Unknown diagnostic phase.");
  const tests = join(state, "maestro/tests"), retained = [];
  if (![state, join(state, "maestro"), tests].every(plainDirectory)) return retained;
  for (const entry of readdirSync(tests, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const folder = join(tests, entry.name);
    if (!plainDirectory(folder) || relative(resolve(state), resolve(folder)).split(sep).includes("..")) continue;
    for (const log of readdirSync(folder, { withFileTypes: true })) {
      if (retained.length >= 8) return retained;
      if (!log.isFile() || !/^xctest_runner_[0-9_-]+\.log$/.test(log.name)) continue;
      const source = join(folder, log.name), stat = lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const fd = openSync(source, "r"); let windows;
      try {
        windows = stat.size <= XCTEST_LOG_BYTES
          ? [window(fd, stat.size, 0, stat.size, XCTEST_LOG_BYTES, env)]
          : [window(fd, stat.size, 0, EARLY_BYTES, EARLY_BYTES, env), window(fd, stat.size, stat.size - (XCTEST_LOG_BYTES - EARLY_BYTES), XCTEST_LOG_BYTES - EARLY_BYTES, XCTEST_LOG_BYTES - EARLY_BYTES - Buffer.byteLength(OMITTED), env)];
      }
      finally { closeSync(fd); }
      const name = `${prefix}-xctest-${retained.length}.log`;
      writeFileSync(join(destination, name), windows.map((item) => item.text).join(windows.length > 1 ? OMITTED : ""));
      const omittedBytes = stat.size - windows.reduce((sum, item) => sum + item.sourceEnd - item.sourceStart, 0);
      writeFileSync(join(destination, name + ".coverage.json"), JSON.stringify({ schemaVersion: 1, sourceBytes: stat.size, continuous: omittedBytes === 0 && windows.every((item) => !item.postRedactionTruncated), omittedBytes, windows: windows.map(({ text: _text, ...metadata }) => metadata) }) + "\n");
      retained.push(name);
    }
  }
  return retained;
}
