import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { captureDriverEvidence, inspectDriverEvidence, ownedTempOption, prepareDriverScratch, readPlist, readResultSynopsis, resultIssueSynopsis } from "./driverEvidence.mjs";
import { snapshotEvidence } from "./snapshot.mjs";

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "driver-identity-")), state = join(base, ".state"); mkdirSync(state);
  const scratch = prepareDriverScratch(state);
  return { base, state, ...scratch, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}
const xml = (body) => Buffer.from('<?xml version="1.0"?><plist version="1.0">' + body + "</plist>");
const plist = (values) => xml("<dict>" + Object.entries(values).map(([k, v]) => `<key>${k}</key><string>${v}</string>`).join("") + "</dict>");
function thinMachO() {
  const bytes = Buffer.alloc(80); bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(0x100000c, 4);
  bytes.writeUInt32LE(2, 16); bytes.writeUInt32LE(48, 20);
  bytes.writeUInt32LE(0x1b, 32); bytes.writeUInt32LE(24, 36); Buffer.from("74ffcafcaac53e49a7852fac0407afdb", "hex").copy(bytes, 40);
  bytes.writeUInt32LE(0x32, 56); bytes.writeUInt32LE(24, 60); bytes.writeUInt32LE(7, 64); bytes.writeUInt32LE(917504, 68); bytes.writeUInt32LE(1704448, 72);
  return bytes;
}
function products(f) {
  const host = join(f.root, "Debug-iphonesimulator", "maestro-driver-iosUITests-Runner.app"), bundle = join(host, "PlugIns", "maestro-driver-iosUITests.xctest");
  mkdirSync(bundle, { recursive: true });
  for (const [folder, executable] of [[host, "maestro-driver-iosUITests-Runner"], [bundle, "maestro-driver-iosUITests"]]) {
    writeFileSync(join(folder, "Info.plist"), plist({ CFBundleExecutable: executable, DTXcode: "2620", DTXcodeBuild: "17C52", DTSDKBuild: "23C53", MinimumOSVersion: "14.0", PRIVATE: "player-secret" }));
    writeFileSync(join(folder, executable), thinMachO());
  }
  writeFileSync(join(f.root, "driver.xctestrun"), xml(`<dict><key>target</key><dict><key>TestHostPath</key><string>__TESTROOT__/Debug-iphonesimulator/maestro-driver-iosUITests-Runner.app</string><key>TestBundlePath</key><string>__TESTHOST__/PlugIns/maestro-driver-iosUITests.xctest</string><key>OnlyTestIdentifiers</key><array><string>maestro_driver_iosUITests/maestro_driver_iosUITests/testHttpServer</string></array><key>EnvironmentVariables</key><dict><key>SECRET</key><string>private-env</string></dict></dict></dict>`));
  return { host, bundle };
}

test("fresh private scratch and a single fixed launcher option; unsupported controls stay unavailable", () => {
  const f = fixture();
  try {
    const second = prepareDriverScratch(f.state); assert.notEqual(f.root, second.root);
    assert(f.root.startsWith(f.state));
    if (process.platform !== "win32") assert.equal(statSync(f.root).mode & 0o777, 0o700);
    for (const value of ["relative", "/line\nbreak", "/bad\rpath", "/bad\0path"]) assert.equal(ownedTempOption(value), null);
    const path = join(f.root, 'space $;`apostrophe\' quote"back\\slash');
    assert.equal(ownedTempOption(path), "'-Djava.io.tmpdir=" + path.replaceAll("'", "'\\''") + "'");
    assert.equal(prepareDriverScratch(join(f.base, "absent")).reason, "scratch-unavailable");
  } finally { f.cleanup(); }
});

test("snapshot excludes the complete scratch subtree and raw identities", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "private-raw.jar"), "private"); writeFileSync(join(f.base, "summary.json"), "{}");
    const target = join(f.base, "..", "published-" + Date.now());
    try { const report = snapshotEvidence(f.base, target, {}); assert.deepEqual(report.artifacts.map((a) => a.path), ["summary.json"]); }
    finally { rmSync(target, { recursive: true, force: true }); }
  } finally { f.cleanup(); }
});

test("actual xctestrun references bind observed file hashes, UUID and finite build metadata", () => {
  const f = fixture();
  try {
    products(f);
    const evidence = inspectDriverEvidence({ root: f.root });
    assert.equal(evidence.reason, "files-observed-not-loaded-images"); assert.equal(evidence.loadedImage, "unattested");
    const binary = evidence.observed.find((item) => item.role === "test-binary");
    assert.equal(binary.sha256, createHash("sha256").update(thinMachO()).digest("hex"));
    assert.equal(binary.slices[0].uuid, "74ffcafc-aac5-3e49-a785-2fac0407afdb");
    assert.deepEqual(binary.build, { DTXcode: "2620", DTXcodeBuild: "17C52", DTSDKBuild: "23C53", MinimumOSVersion: "14.0" });
    assert.equal(evidence.plans[0].targets[0].selection, "explicit-http-server");
    const text = JSON.stringify(evidence);
    for (const secret of [f.root, "player-secret", "private-env", "EnvironmentVariables", "maestro-driver-iosUITests-Runner.app"]) assert(!text.includes(secret));
    assert(Buffer.byteLength(text) < 16384);
    assert.equal(evidence.results[0].reason, "no-result-bundle");
  } finally { f.cleanup(); }
});

test("only the PATH-resolved CLI and adjacent known JARs are hashed, never executed", () => {
  const f = fixture();
  try {
    const cli = join(f.base, "installed/bin/maestro"), lib = join(f.base, "installed/lib"); mkdirSync(dirname(cli), { recursive: true }); mkdirSync(lib);
    writeFileSync(cli, "must not execute", { mode: 0o700 }); writeFileSync(join(lib, "maestro-cli-2.10.0.jar"), "cli"); writeFileSync(join(lib, "maestro-ios-driver.jar"), "driver"); writeFileSync(join(lib, "unrelated.jar"), "not inspected");
    const evidence = inspectDriverEvidence({ root: f.root, path: dirname(cli) });
    assert.deepEqual(evidence.observed.map((v) => v.role), ["cli-launcher", "cli-jar", "driver-jar"]);
    assert(!JSON.stringify(evidence).includes("must not execute"));
  } finally { f.cleanup(); }
});

test("universal Mach-O slices retain UUID/build identity without interpreting binary contents", () => {
  const f = fixture();
  try {
    const p = products(f), fat = Buffer.alloc(8192 + 80), thin = thinMachO();
    fat.writeUInt32BE(0xcafebabe); fat.writeUInt32BE(2, 4);
    for (const [i, offset] of [[0, 4096], [1, 8192]]) { fat.writeUInt32BE(offset, 8 + i * 20 + 8); fat.writeUInt32BE(80, 8 + i * 20 + 12); thin.copy(fat, offset); }
    writeFileSync(join(p.bundle, "maestro-driver-iosUITests"), fat);
    const binary = inspectDriverEvidence({ root: f.root }).observed.find((v) => v.role === "test-binary");
    assert.equal(binary.slices.length, 2); assert(binary.slices.every((slice) => slice.platform === 7 && slice.sdk === 1704448));
  } finally { f.cleanup(); }
});

test("missing, malformed, escaping and stale plans never establish an observed destination", () => {
  for (const mode of ["missing", "malformed", "traversal", "absolute", "bad-binary", "no-executable"]) {
    const f = fixture();
    try {
      const p = products(f), plan = join(f.root, "driver.xctestrun");
      if (mode === "missing") rmSync(plan);
      if (mode === "malformed") writeFileSync(plan, "private malformed text");
      if (mode === "traversal" || mode === "absolute") writeFileSync(plan, xml(`<dict><key>target</key><dict><key>TestHostPath</key><string>${mode === "absolute" ? f.base.replaceAll("\\", "/") : "../stale.app"}</string><key>TestBundlePath</key><string>../other-session</string></dict></dict>`));
      if (mode === "bad-binary") writeFileSync(join(p.host, "maestro-driver-iosUITests-Runner"), "not MachO");
      if (mode === "no-executable") writeFileSync(join(p.host, "Info.plist"), plist({ CFBundleExecutable: "../../private" }));
      const evidence = inspectDriverEvidence({ root: f.root });
      assert.equal(evidence.reason, "identity-incomplete", mode);
      assert(!JSON.stringify(evidence).includes("private malformed"));
    } finally { f.cleanup(); }
  }
});

test("owned-root discovery rejects symlinks, other sessions and linked test-plan references", () => {
  const f = fixture();
  try {
    const other = prepareDriverScratch(f.state); products(other);
    symlinkSync(other.root, join(f.root, "linked"), "junction");
    const evidence = inspectDriverEvidence({ root: f.root }); assert.equal(evidence.observed.length, 0); assert.equal(evidence.discovery, "partial");
    assert.equal(inspectDriverEvidence({ root: join(f.root, "linked") }).reason, "unsafe-root");
    const plan = join(f.root, "driver.xctestrun");
    writeFileSync(plan, xml('<dict><key>target</key><dict><key>TestHostPath</key><string>__TESTROOT__/linked/Debug-iphonesimulator/maestro-driver-iosUITests-Runner.app</string><key>TestBundlePath</key><string>__TESTHOST__/PlugIns/maestro-driver-iosUITests.xctest</string></dict></dict>'));
    const linked = inspectDriverEvidence({ root: f.root }); assert(!linked.observed.some((v) => v.role === "runner"));
  } finally { f.cleanup(); }
});

test("bounded discovery and metadata fail conservatively without free-form errors", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "large.xctestrun"), Buffer.alloc(65537));
    assert.equal(inspectDriverEvidence({ root: f.root }).plans[0].reason, "malformed-plan");
    assert.equal(inspectDriverEvidence({ root: f.root, deadline: 0 }).reason, "bounded-or-unreadable");
    assert.throws(() => readPlist(Buffer.alloc(65537)));
    assert.throws(() => readPlist(xml('<!ENTITY leak SYSTEM "file:///private"><string>&leak;</string>')));
    assert.throws(() => readPlist(Buffer.from("bplist00")));
    const binary = Buffer.from("YnBsaXN0MDDRAQJRa1F2CAsNAAAAAAAAAQEAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAA8=", "base64");
    assert.equal(readPlist(binary).k, "v");
  } finally { f.cleanup(); }
});

test("result issue synopsis is a finite schema with no messages, test names, stacks or identifiers", () => {
  const item = { issueType: { _value: "Assertion Failure" }, message: { _value: "private message" }, testCaseName: { _value: "private test" } };
  assert.deepEqual(resultIssueSynopsis({ issues: { testFailureSummaries: { _values: [item] } } }), { status: "observed", coverage: "test-failure-summaries-only", issues: [{ kind: "assertion-failure", code: null, severity: "error" }] });
  assert.equal(resultIssueSynopsis({}).reason, "unsupported-schema");
  assert.equal(resultIssueSynopsis({ issues: { testFailureSummaries: { _values: [{ issueType: { _value: "arbitrary private kind" } }] } } }).reason, "unsupported-schema");
});

test("production discovery validates result trees inside the worker boundary and retains no private paths", () => {
  const f = fixture();
  try {
    const bundle = join(f.root, "private-result.xcresult"); mkdirSync(bundle);
    const found = [], evidence = inspectDriverEvidence({ root: f.root, onResultBundle: (record) => found.push(record) });
    assert.deepEqual(found, [{ index: 0, path: bundle }]);
    assert.equal(evidence.results[0].reason, "unsupported-reader");
    assert(!JSON.stringify(evidence).includes(bundle));
    symlinkSync(f.state, join(bundle, "linked"), "junction");
    const rejected = []; const unsafe = inspectDriverEvidence({ root: f.root, onResultBundle: (record) => rejected.push(record) });
    assert.equal(unsafe.results[0].reason, "unsafe-or-bounded-result"); assert.deepEqual(rejected, []);
  } finally { f.cleanup(); }
});

test("optional result reader denies absent/escaping/linked bundles and bounds installed-tool reads", async () => {
  const f = fixture();
  try {
    assert.equal((await readResultSynopsis(f.root, join(f.root, "absent"), Date.now() + 1000)).status, "unavailable");
    assert.equal((await readResultSynopsis(f.root, f.base, Date.now() + 1000)).reason, "unsafe-result");
    const bundle = join(f.root, "result.xcresult"); mkdirSync(bundle);
    assert.equal((await readResultSynopsis(f.root, bundle, 0)).reason, "deadline");
    let calls = 0;
    const run = (command, args, options, callback) => {
      calls++; assert.equal(command, "/usr/bin/xcrun"); assert.equal(args[5], bundle); assert(options.timeout <= 1000); assert.equal(options.maxBuffer, 65536); assert.deepEqual(options.env, { PATH: "/usr/bin:/bin" });
      callback(null, JSON.stringify({ issues: { testFailureSummaries: { _values: [] } } }));
    };
    assert.equal((await readResultSynopsis(f.root, bundle, Date.now() + 1000, { run, platform: "darwin" })).status, "observed"); assert.equal(calls, 1);
    const malformed = (_command, _args, _options, callback) => callback(null, "private non-JSON message");
    assert.equal((await readResultSynopsis(f.root, bundle, Date.now() + 1000, { run: malformed, platform: "darwin" })).reason, "unsupported-schema");
    symlinkSync(f.state, join(bundle, "escape"), "junction");
    assert.equal((await readResultSynopsis(f.root, bundle, Date.now() + 1000, { run, platform: "darwin" })).status, "unavailable"); assert.equal(calls, 1);
  } finally { f.cleanup(); }
});

test("real delayed metadata process is killed and reaped within the existing deadline", async () => {
  const f = fixture(); let child;
  try {
    const bundle = join(f.root, "result.xcresult"); mkdirSync(bundle);
    const run = (_command, _args, options, callback) => { child = execFile(process.execPath, ["-e", "setInterval(()=>{},1000)"], options, callback); return child; };
    const started = Date.now(); const result = await readResultSynopsis(f.root, bundle, started + 200, { platform: "darwin", run });
    assert.equal(result.reason, "bounded-tool-unavailable"); assert(Date.now() - started < 3000); assert(child.killed); assert(child.signalCode || child.exitCode !== null);
  } finally { f.cleanup(); }
});

test("a stalled real worker is terminated, while errors and an expired deadline stay advisory", async () => {
  const f = fixture(); let worker;
  try {
    class StalledWorker { constructor() { worker = new Worker("setInterval(()=>{},1000)", { eval: true }); return worker; } }
    const result = await captureDriverEvidence({ root: f.root, path: "", deadline: Date.now() + 200, WorkerClass: StalledWorker });
    assert.equal(result.reason, "budget"); assert.equal(worker.threadId, -1);
    assert.equal((await captureDriverEvidence({ root: f.root, deadline: 0 })).reason, "deadline");
    class FailedWorker { constructor() { throw new Error("private injected error"); } }
    const failure = await captureDriverEvidence({ root: f.root, deadline: Date.now() + 5000, WorkerClass: FailedWorker });
    assert.equal(failure.reason, "worker-unavailable"); assert(!JSON.stringify(failure).includes("private"));
    const actual = await captureDriverEvidence({ root: f.root, path: "", deadline: Date.now() + 5000 });
    assert.equal(actual.reason, "identity-incomplete");
    assert.deepEqual(readdirSync(f.root), []);
  } finally { f.cleanup(); }
});
