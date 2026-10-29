import { closeSync, openSync, readSync, existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

/** Only this phase's isolated XCTest logs; bounded complete lines, no symlinks. */
export function retainXCTestLogs(state, destination, prefix, env) {
  const tests = join(state, "maestro/tests"), retained = [];
  if (!existsSync(tests) || !lstatSync(tests).isDirectory() || lstatSync(tests).isSymbolicLink()) return retained;
  for (const entry of readdirSync(tests, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const folder = join(tests, entry.name);
    for (const log of readdirSync(folder, { withFileTypes: true })) {
      if (retained.length >= 8) return retained;
      if (!log.isFile() || !/^xctest_runner_[0-9_-]+\.log$/.test(log.name)) continue;
      const source = join(folder, log.name), stat = lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const bytes = Buffer.alloc(Math.min(stat.size, 512 * 1024));
      const fd = openSync(source, "r"); let count;
      try { count = readSync(fd, bytes, 0, bytes.length, Math.max(0, stat.size - bytes.length)); }
      finally { closeSync(fd); }
      let text = bytes.subarray(0, count).toString("utf8");
      if (stat.size > bytes.length) text = text.slice(text.indexOf("\n") + 1);
      // A detached writer may be halfway through a credential-bearing line.
      text = text.slice(0, text.lastIndexOf("\n") + 1);
      const name = `${prefix}-xctest-${retained.length}.log`;
      writeFileSync(join(destination, name), redactDriverLog(text, env)); retained.push(name);
    }
  }
  return retained;
}
