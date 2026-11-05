import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, accessSync, closeSync, fstatSync, lstatSync, mkdtempSync, openSync, readSync, opendirSync, realpathSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const LIMITS = Object.freeze({ entries: 4096, depth: 12, files: 32, fileBytes: 128 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, metadataBytes: 65536, milliseconds: 5000 });
const EXPECTED = Object.freeze({ cliVersion: "2.10.0", archiveSha256: "29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991", cliJarSha256: "edf1a9ec465f1fbe7a325d2f166e1135f19deeb671f9dd76aeedf8e6f887845c", driverJarSha256: "1a4e4582e7b415167782711c04b914df878899d04757a2de82c3bf7a5b4c99f1", testBinarySha256: "a0ae28c13199eb0172c64912cbbd5708a045f3d09504730605bca5ecd426059f", supportedBuildSource: "3ff379997a4879b174458cbd58ecade5641e8609" });

export function unavailableDriverEvidence(reason) {
  return { schemaVersion: 1, status: "unavailable", reason, expectedPackage: EXPECTED, loadedImage: "unattested", limits: LIMITS };
}

/** xargs in the pinned launcher parses one quoted option, then shell-escapes it. */
export function ownedTempOption(path) {
  if (typeof path !== "string" || !isAbsolute(path) || [...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
  // xargs treats backslashes literally inside quotes. Close the single quote,
  // escape an apostrophe outside it, then reopen; never evaluate path fragments.
  return "'-Djava.io.tmpdir=" + path.replaceAll("'", "'\\''") + "'";
}

export function prepareDriverScratch(state) {
  try {
    const stat = lstatSync(state);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { reason: "unsafe-state" };
    const canonical = realpathSync(state);
    if (!ownedTempOption(join(canonical, ".jvm-"))) return { reason: "unsupported-path" };
    const root = mkdtempSync(join(canonical, ".jvm-"), { encoding: "utf8" });
    // mkdtemp creates a private 0700 directory. No old state or shared temp is adopted.
    return { root, option: ownedTempOption(root) };
  } catch { return { reason: "scratch-unavailable" }; }
}

function contained(root, path) {
  const rel = relative(root, resolve(path));
  if (isAbsolute(rel) || rel.split(sep).includes("..")) return false;
  let current = root;
  if (lstatSync(root).isSymbolicLink()) return false;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) return false;
  }
  return realpathSync(path) === resolve(path);
}

function validateResultTree(root, bundle, deadline) {
  if (!contained(root, bundle) || !lstatSync(bundle).isDirectory()) throw new Error("unsafe-result");
  let entries = 0, bytes = 0;
  function walk(folder, depth = 0) {
    if (depth > 8 || Date.now() >= deadline) throw new Error("result-bound");
    const directory = opendirSync(folder);
    try { for (let entry; (entry = directory.readSync()) !== null;) {
      const path = join(folder, entry.name);
      if (++entries > 256 || entry.isSymbolicLink() || !contained(root, path)) throw new Error("result-bound");
      if (entry.isDirectory()) walk(path, depth + 1);
      else { const stat = lstatSync(path); if (!stat.isFile() || (bytes += stat.size) > LIMITS.fileBytes) throw new Error("result-bound"); }
    } } finally { directory.closeSync(); }
  }
  walk(bundle);
}

/** A bounded plist decoder; no entity resolution, tools, executable code or archives. */
export function readPlist(bytes) {
  if (bytes.length > LIMITS.metadataBytes) throw new Error("metadata-bound");
  let nodes = 0;
  function check(depth) { if (++nodes > 4096 || depth > 16) throw new Error("plist-bound"); }
  if (bytes.subarray(0, 8).toString() === "bplist00") {
    const trailer = bytes.length - 32, width = bytes[trailer + 6], refWidth = bytes[trailer + 7];
    const number = (at, size) => { if (![1, 2, 4, 8].includes(size) || at < 0 || at + size > bytes.length) throw new Error("plist-number"); const n = Number([...bytes.subarray(at, at + size)].reduce((n, b) => n * 256n + BigInt(b), 0n)); if (!Number.isSafeInteger(n)) throw new Error("plist-number"); return n; };
    const count = number(trailer + 8, 8), top = number(trailer + 16, 8), table = number(trailer + 24, 8);
    if (count > 4096 || count < 1 || top >= count || table + count * width > trailer) throw new Error("plist-table");
    function item(index, depth = 0) {
      check(depth); if (index >= count) throw new Error("plist-reference");
      let at = number(table + index * width, width);
      const marker = bytes[at++], type = marker >> 4; let length = marker & 15;
      if (length === 15 && [4, 5, 6, 10, 13].includes(type)) { const m = bytes[at++]; if ((m >> 4) !== 1) throw new Error("plist-length"); const size = 2 ** (m & 15); length = number(at, size); at += size; }
      if (length > LIMITS.metadataBytes) throw new Error("plist-length");
      if (type === 0) return marker === 9 ? true : marker === 8 ? false : null;
      if (type === 1) return number(at, 2 ** length);
      if (type === 5 || type === 6) {
        const size = length * (type === 6 ? 2 : 1); if (at + size > table) throw new Error("plist-string");
        if (type === 5) return bytes.subarray(at, at + size).toString("ascii");
        return Array.from({ length }, (_, i) => String.fromCharCode(bytes.readUInt16BE(at + i * 2))).join("");
      }
      if (type === 4) return null; // Data is deliberately not interpreted or retained.
      if (type === 10) return Array.from({ length }, (_, i) => item(number(at + i * refWidth, refWidth), depth + 1));
      if (type === 13) {
        const value = Object.create(null);
        for (let i = 0; i < length; i++) { const key = item(number(at + i * refWidth, refWidth), depth + 1); if (typeof key !== "string") throw new Error("plist-key"); value[key] = item(number(at + (i + length) * refWidth, refWidth), depth + 1); }
        return value;
      }
      throw new Error("plist-type");
    }
    return item(top);
  }
  const text = bytes.toString("utf8").replace(/<\?xml[^?]*\?>/, "").replace(/<!DOCTYPE plist PUBLIC "-\/\/Apple\/\/DTD PLIST 1.0\/\/EN" "http:\/\/www.apple.com\/DTDs\/PropertyList-1.0.dtd">/, "");
  if (/<!|&(?!(?:amp|lt|gt|quot|apos);)/.test(text)) throw new Error("plist-entities");
  const tokens = text.match(/<[^>]*>|[^<]+/g)?.filter((t) => t.trim()) ?? []; let index = 0;
  const decode = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name]);
  function item(depth = 0) {
    check(depth); const tag = tokens[index++];
    if (tag === "<true/>" || tag === "<false/>") return tag === "<true/>";
    if (tag === "<dict>" || tag === "<array>") {
      const dict = tag === "<dict>", value = dict ? Object.create(null) : [], end = dict ? "</dict>" : "</array>";
      while (tokens[index] !== end) {
        if (index >= tokens.length) throw new Error("plist-truncated");
        if (dict) { if (tokens[index++] !== "<key>") throw new Error("plist-key"); const key = decode(tokens[index++]); if (tokens[index++] !== "</key>") throw new Error("plist-key"); value[key] = item(depth + 1); }
        else value.push(item(depth + 1));
      }
      index++; return value;
    }
    if (/^<(string|integer|real|data|date)>$/.test(tag ?? "")) {
      const type = tag.slice(1, -1), end = `</${type}>`, raw = tokens[index] === end ? "" : tokens[index++];
      if (tokens[index++] !== end) throw new Error("plist-value");
      return type === "integer" ? Number(raw) : type === "string" ? decode(raw) : null;
    }
    if (tag === "<string/>" || tag === "<array/>" || tag === "<dict/>") return tag === "<string/>" ? "" : tag === "<array/>" ? [] : Object.create(null);
    throw new Error("plist-tag");
  }
  if (!/^<plist(?: version="1.0")?>$/.test(tokens[index++])) throw new Error("plist-header");
  const result = item(); if (tokens[index++] !== "</plist>" || index !== tokens.length) throw new Error("plist-trailer"); return result;
}

function macho(fd, size) {
  const read = (at, count) => { if (at < 0 || count > 65536 || at + count > size) throw new Error("macho-bound"); const b = Buffer.alloc(count); if (readSync(fd, b, 0, count, at) !== count) throw new Error("macho-short"); return b; };
  const header = read(0, Math.min(32, size)), magic = header.readUInt32BE(0);
  let offsets = [0];
  if (magic === 0xcafebabe) { const n = header.readUInt32BE(4); if (n > 4) throw new Error("macho-slices"); const fat = read(8, n * 20); offsets = Array.from({ length: n }, (_, i) => fat.readUInt32BE(i * 20 + 8)); }
  else if (header.readUInt32LE(0) !== 0xfeedfacf) return [];
  return offsets.map((offset) => {
    const h = read(offset, 32); if (h.readUInt32LE(0) !== 0xfeedfacf) throw new Error("macho-header");
    const count = h.readUInt32LE(16), length = h.readUInt32LE(20), b = read(offset + 32, length);
    if (count > 1024) throw new Error("macho-commands");
    const result = { cpu: h.readUInt32LE(4) }; let at = 0;
    for (let i = 0; i < count; i++) {
      const cmd = b.readUInt32LE(at), n = b.readUInt32LE(at + 4); if (n < 8 || at + n > b.length) throw new Error("macho-command");
      if (cmd === 0x1b && n === 24) result.uuid = b.subarray(at + 8, at + 24).toString("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
      if (cmd === 0x32 && n >= 24) { result.platform = b.readUInt32LE(at + 8); result.minimumOS = b.readUInt32LE(at + 12); result.sdk = b.readUInt32LE(at + 16); }
      at += n;
    }
    return result;
  });
}

/** Static file observation, not a loaded-memory or executed-image attestation. */
export function inspectDriverEvidence({ root, path = "", deadline = Date.now() + LIMITS.milliseconds, onResultBundle = () => {} }) {
  const output = { ...unavailableDriverEvidence("no-identity"), status: "partial", observed: [], plans: [], results: [], discovery: "complete" };
  let entries = 0, total = 0;
  const check = () => { if (Date.now() >= deadline) throw new Error("budget"); };
  function file(path, boundary, role, metadata = false) {
    check(); if (!contained(boundary, path)) throw new Error("unsafe-path");
    if (!lstatSync(path).isFile()) throw new Error("not-regular-file");
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const stat = fstatSync(fd), limit = metadata ? LIMITS.metadataBytes : LIMITS.fileBytes;
      if (!stat.isFile() || stat.size > limit || total + stat.size > LIMITS.totalBytes || output.observed.length >= LIMITS.files) throw new Error("file-bound");
      total += stat.size;
      const hash = createHash("sha256"), chunk = Buffer.alloc(Math.min(1024 * 1024, stat.size)), captured = metadata ? Buffer.alloc(stat.size) : null; let at = 0;
      while (at < stat.size) { check(); const n = readSync(fd, chunk, 0, Math.min(chunk.length, stat.size - at), at); if (!n) throw new Error("short-file"); hash.update(chunk.subarray(0, n)); if (captured) chunk.copy(captured, at, 0, n); at += n; }
      const after = fstatSync(fd); if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error("changed-file");
      const record = { role, bytes: stat.size, sha256: hash.digest("hex") };
      if (!metadata && ["runner", "test-binary", "driver-library"].includes(role)) {
        record.slices = macho(fd, stat.size); if (!record.slices.length) throw new Error("not-macho");
      }
      output.observed.push(record);
      if (metadata) return readPlist(captured);
      return record;
    } finally { closeSync(fd); }
  }
  try {
    if (!root || !isAbsolute(root) || !contained(root, root) || !lstatSync(root).isDirectory()) return unavailableDriverEvidence("unsafe-root");
    // Resolve only this child's PATH executable, then the two known adjacent JARs.
    for (const folder of path.split(delimiter).filter((p) => isAbsolute(p))) {
      const candidate = join(folder, "maestro");
      try {
        accessSync(candidate, constants.X_OK);
        const cli = realpathSync(candidate), home = dirname(dirname(cli));
        file(cli, dirname(cli), "cli-launcher");
        for (const [name, role] of [["maestro-cli-2.10.0.jar", "cli-jar"], ["maestro-ios-driver.jar", "driver-jar"]]) {
          try { file(join(home, "lib", name), home, role); } catch { output.discovery = "partial"; }
        }
        break;
      } catch { /* A missing executable is unavailable, not evidence of no launch. */ }
    }
    const plans = [];
    function walk(folder, depth) {
      check(); if (depth > LIMITS.depth || !contained(root, folder)) { output.discovery = "partial"; return; }
      // Streaming enumeration avoids materializing an unbounded directory listing.
      const list = opendirSync(folder);
      try { for (let entry; (entry = list.readSync()) !== null;) {
        check(); if (++entries > LIMITS.entries) throw new Error("entry-bound");
        const full = join(folder, entry.name);
        if (entry.isSymbolicLink()) { output.discovery = "partial"; continue; }
        if (entry.isDirectory()) {
          if (entry.name.endsWith(".xcresult")) {
            if (output.results.length < 4) {
              const index = output.results.length;
              try { validateResultTree(root, full, deadline); output.results.push({ status: "unavailable", reason: "unsupported-reader" }); onResultBundle({ path: full, index }); }
              catch { output.results.push({ status: "unavailable", reason: "unsafe-or-bounded-result" }); output.discovery = "partial"; }
            } else output.discovery = "partial";
            continue;
          }
          walk(full, depth + 1);
        } else if (entry.isFile() && entry.name.endsWith(".xctestrun")) plans.push(full);
      } } finally { list.closeSync(); }
    }
    walk(root, 0);
    for (const plan of plans.slice(0, 4)) {
      const summary = { status: "unavailable", reason: "malformed-plan" };
      try {
        const data = file(plan, root, "test-plan", true), targets = Object.values(data).filter((v) => v && typeof v === "object" && typeof v.TestHostPath === "string");
        if (targets.length > 4 || !targets.length) throw new Error("plan-targets");
        summary.status = "observed"; delete summary.reason; summary.targets = [];
        for (const target of targets) {
          const resolveRef = (value, host = "") => {
            if (typeof value !== "string" || /[\0\r\n]/.test(value)) throw new Error("plan-reference");
            const resolved = resolve(dirname(plan), value.replaceAll("__TESTROOT__", dirname(plan)).replaceAll("__TESTHOST__", host));
            if (resolved.includes("__") || !contained(root, resolved)) throw new Error("plan-reference"); return resolved;
          };
          const host = resolveRef(target.TestHostPath), bundle = resolveRef(target.TestBundlePath, host);
          const only = target.OnlyTestIdentifiers;
          const item = { host: "unavailable", bundle: "unavailable", onlyTestCount: Array.isArray(only) ? only.length : null, skippedTestCount: Array.isArray(target.SkipTestIdentifiers) ? target.SkipTestIdentifiers.length : null,
            selection: only?.includes("maestro_driver_iosUITests/maestro_driver_iosUITests/testHttpServer") === true ? "explicit-http-server" : Array.isArray(only) ? "explicit-other-or-unknown" : "default-or-unknown",
            timeoutsEnabled: typeof target.TestTimeoutsEnabled === "boolean" ? target.TestTimeoutsEnabled : null };
          for (const [directory, role, key] of [[host, "runner", "host"], [bundle, "test-binary", "bundle"]]) {
            const info = file(join(directory, "Info.plist"), root, "bundle-info", true);
            if (typeof info.CFBundleExecutable !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(info.CFBundleExecutable)) throw new Error("bundle-executable");
            const identity = file(join(directory, info.CFBundleExecutable), root, role);
            item[key] = "observed";
            identity.build = Object.fromEntries(["DTXcode", "DTXcodeBuild", "DTSDKBuild", "MinimumOSVersion"].filter((k) => typeof info[k] === "string" && (k === "DTXcode" || k === "MinimumOSVersion" ? /^[0-9]{1,5}(?:\.[0-9]{1,3}){0,2}$/ : /^[0-9]{1,3}[A-Z][0-9]{1,6}[a-z]?$/).test(info[k])).map((k) => [k, info[k]]));
          }
          summary.targets.push(item);
        }
      } catch { output.discovery = "partial"; }
      output.plans.push(summary);
    }
    if (plans.length > 4) output.discovery = "partial";
    output.reason = output.plans.some((p) => p.status === "observed" && p.targets?.some((t) => t.host === "observed" && t.bundle === "observed")) ? "files-observed-not-loaded-images" : "identity-incomplete";
    if (!output.results.length) output.results.push({ status: "unavailable", reason: "no-result-bundle" });
  } catch { output.discovery = "partial"; output.reason = "bounded-or-unreadable"; }
  output.entriesVisited = Math.min(entries, LIMITS.entries); output.bytesRead = total;
  return output;
}

/** Legacy get-object has a typed issue schema. Unknown kinds/messages are never copied. */
export function resultIssueSynopsis(data) {
  const values = data?.issues?.testFailureSummaries?._values;
  if (!Array.isArray(values) || values.length > 32) return { status: "unavailable", reason: "unsupported-schema" };
  const kinds = { "Assertion Failure": "assertion-failure", "Uncaught Exception": "exception", "System Failure": "system-failure", "Test Failure": "test-failure" };
  if (values.some((item) => !Object.hasOwn(kinds, item?.issueType?._value))) return { status: "unavailable", reason: "unsupported-schema" };
  return { status: "observed", coverage: "test-failure-summaries-only", issues: values.map((item) => ({ kind: kinds[item.issueType._value], code: null, severity: "error" })) };
}

export async function readResultSynopsis(root, bundle, deadline, { run = execFile, platform = process.platform, validatedInWorker = false } = {}) {
  try {
    if (Date.now() >= deadline) return { status: "unavailable", reason: "deadline" };
    // Production discovery validates in the terminable worker. This direct path
    // exists for injected unit controls, never as another parent-thread scan.
    if (!validatedInWorker) {
      if (!contained(root, bundle) || !lstatSync(bundle).isDirectory()) return { status: "unavailable", reason: "unsafe-result" };
      validateResultTree(root, bundle, deadline);
    }
    const milliseconds = Math.max(0, Math.min(1000, deadline - Date.now()));
    if (!milliseconds) return { status: "unavailable", reason: "deadline" };
    if (platform !== "darwin") return { status: "unavailable", reason: "unsupported-tool" };
    return await new Promise((resolve) => {
      run("/usr/bin/xcrun", ["xcresulttool", "get", "object", "--legacy", "--path", bundle, "--format", "json"],
        { timeout: milliseconds, killSignal: "SIGKILL", maxBuffer: 65536, encoding: "utf8", env: { PATH: "/usr/bin:/bin" } }, (error, stdout) => {
          if (error) { resolve({ status: "unavailable", reason: "bounded-tool-unavailable" }); return; }
          try { resolve(resultIssueSynopsis(JSON.parse(stdout))); }
          catch { resolve({ status: "unavailable", reason: "unsupported-schema" }); }
        });
    });
  } catch { return { status: "unavailable", reason: "unreadable-result" }; }
}

/** Hard termination caps advisory work at five seconds inside the existing deadline. */
export async function captureDriverEvidence({ root, path, deadline, WorkerClass = Worker }) {
  if (!root) return unavailableDriverEvidence("scratch-unavailable");
  const milliseconds = Math.max(0, Math.min(LIMITS.milliseconds, deadline - Date.now()));
  const captureDeadline = Date.now() + milliseconds;
  if (!milliseconds) return unavailableDriverEvidence("deadline");
  let worker, timer;
  try {
    worker = new WorkerClass(new URL(import.meta.url), { workerData: { driverEvidence: true, root, path, deadline: captureDeadline }, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    const result = await new Promise((resolve) => {
      let done = false;
      const finish = (value) => { if (!done) { done = true; resolve(value); } };
      timer = setTimeout(() => finish(unavailableDriverEvidence("budget")), milliseconds);
      worker.once("message", finish);
      worker.once("error", () => finish(unavailableDriverEvidence("worker-unavailable")));
      worker.once("exit", () => finish(unavailableDriverEvidence("worker-exited")));
    });
    clearTimeout(timer); await worker.terminate(); worker = undefined;
    if (!result.evidence) return result;
    const evidence = result.evidence;
    // Only installed metadata tooling is executed. The downloaded runner is never run.
    for (const bundle of result.bundles) evidence.results[bundle.index] = await readResultSynopsis(root, bundle.path, captureDeadline, { validatedInWorker: true });
    return evidence;
  } catch { return unavailableDriverEvidence("worker-unavailable"); }
  finally { clearTimeout(timer); await worker?.terminate(); }
}

if (!isMainThread && workerData?.driverEvidence === true) {
  try { const bundles = []; const evidence = inspectDriverEvidence({ ...workerData, onResultBundle: (path) => bundles.push(path) }); parentPort.postMessage({ evidence, bundles }); }
  catch { parentPort.postMessage(unavailableDriverEvidence("worker-unavailable")); }
}
