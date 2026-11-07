import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { observedSpawn, resultErrorClass, retainPhase7, testLogSynopsis } from "./ax-request/result.mjs";

const sourceRoot = resolve(import.meta.dirname, "../..");
const started = "Test Case '-[driver.HSAXRequestQualificationTests test00ForwardOnceControls]' started.\n";
const failed = "Test Case '-[driver.HSAXRequestQualificationTests test00ForwardOnceControls]' failed (0.01 seconds).\n";
const legacy = { issues: { testFailureSummaries: { _values: [{ issueType: { _value: "Assertion Failure" }, message: { _value: "SECRET_UI_PAYLOAD" }, testCaseName: { _value: "SECRET_TEST" } }] } } };
const receipt = () => ({ source: "a".repeat(40), driverSource: "b".repeat(40), runId: "123", runAttempt: "1", phase: 7,
  driverBuild: { executableSha256: "c".repeat(64), xctestrunSha256: "d".repeat(64) }, build: { manifestSha256: "e".repeat(64), artifactSha256: "f".repeat(64) } });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ax-result-test-")), privateRoot = join(root, "private"), output = join(root, "output");
  mkdirSync(privateRoot); mkdirSync(output);
  t.after(() => { assert.equal(dirname(root), resolve(tmpdir())); assert(root.includes("ax-result-test-")); rmSync(root, { recursive: true }); });
  return { root, privateRoot, output, receipt: receipt(), extraction: 5, failure: 1 };
}
function metadata(f, data = legacy) {
  mkdirSync(join(f.privateRoot, "result.xcresult"));
  return (exe, args, opts, callback) => {
    assert.equal(exe, "/usr/bin/xcrun"); assert.deepEqual(args, ["xcresulttool", "get", "object", "--legacy", "--path", join(f.privateRoot, "result.xcresult"), "--format", "json"]);
    assert.deepEqual(opts.env, { PATH: "/usr/bin:/bin", DEVELOPER_DIR: "/Applications/Xcode_26.6.app/Contents/Developer" });
    assert(opts.timeout > 0 && opts.timeout <= 1000); assert.equal(opts.maxBuffer, 65536); callback(null, JSON.stringify(data), "SECRET_STDERR");
  };
}

test("actual subprocess result is forwarded once, preserving options, bytes, exit and thrown identity", () => {
  const args = ["-e", "process.stdout.write('private');process.exit(65)"], options = { encoding: "utf8", timeout: 10000 }, seen = []; let calls = 0;
  const run = (exe, argv, opts) => { calls++; assert.equal(argv, args); assert.equal(opts, options); return spawnSync(exe, argv, opts); };
  const result = observedSpawn(run, process.execPath, args, options, (v) => seen.push(v));
  assert.equal(calls, 1); assert.equal(result.status, 65); assert.equal(result.stdout, "private");
  assert.deepEqual(seen, [{ observed: true, exit: 65, signal: 0, error: 0, threw: false }]);
  const error = Object.assign(new Error("PRIVATE_ERROR"), { code: "ENOENT" });
  assert.throws(() => observedSpawn(() => { throw error; }, "fixed", args, options, () => { throw new Error(); }), (e) => e === error);
  const raw = { status: 0, stdout: "secret", error: null }; assert.equal(observedSpawn(() => raw, "fixed", args, options, () => { throw new Error(); }), raw);
  assert.equal(observedSpawn(() => raw, "fixed", args, options), raw);
});

test("timeout/launch/signal/unknown results stay finite and never copy raw messages", () => {
  const values = [];
  for (const raw of [{ status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT", message: "secret" } }, { status: null, error: { code: "ENOENT" } },
    { status: 9000, signal: "PRIVATE", error: { code: "PRIVATE" } }, { get status() { throw new Error("secret"); } }])
    observedSpawn(() => raw, "fixed", [], {}, (v) => values.push(v));
  assert.equal(values[0].error, 4); assert.equal(values[0].signal, 1); assert.equal(values[1].error, 2); assert.equal(values[2].exit, null);
  assert.equal(values[3].observed, false); assert.equal(resultErrorClass({ get code() { throw new Error(); } }), 0);
  assert(!JSON.stringify(values).includes("secret")); assert(!JSON.stringify(values).includes("PRIVATE"));
});

test("fixed lifecycle names retain positive started/failed/passed events, never arbitrary test or message text", () => {
  const parsed = testLogSynopsis(started + "error: SECRET_UI_PAYLOAD\n" + failed + "Test Case '-[Other SECRET_TEST]' passed.\n"
    + "Test Case '-[Other test00ForwardOnceControls]' passed (0.01 seconds).\n"
    + "Test case 'HSAXRequestQualificationTests.test10ActualDeviceInfoRequest()' passed on 'PRIVATE_DEVICE' (1 seconds).\n");
  assert.deepEqual(parsed.events, [{ test: 1, outcome: 1 }, { test: 1, outcome: 3 }, { test: 2, outcome: 2 }]);
  assert(!JSON.stringify(parsed).includes("SECRET")); assert(!JSON.stringify(parsed).includes("PRIVATE"));
  assert.deepEqual(testLogSynopsis("\n").events, []); assert.equal(testLogSynopsis("\n").absenceProvesNothing, true);
  assert.equal(testLogSynopsis(started.slice(0, -1)).partialLastLine, true); assert.deepEqual(testLogSynopsis(started.slice(0, -1)).events, []);
  assert.equal(testLogSynopsis(started.repeat(65)).truncated, true); assert.equal(testLogSynopsis(started.repeat(65)).events.length, 64);
  assert.equal(testLogSynopsis("x".repeat(4097) + "\n").status, "partial"); assert.equal(testLogSynopsis("\n".repeat(65537)).truncated, true);
  assert.equal(testLogSynopsis("x".repeat(16 * 1024 * 1024 + 1)).status, "unavailable");
});

test("owned result is reduced to finite issue classes before cleanup, with source/build and original failed command", async (t) => {
  const f = fixture(t); writeFileSync(join(f.privateRoot, "test.private"), started + failed); const run = metadata(f);
  const result = await retainPhase7({ ...f, command: { observed: true, exit: 65, signal: 0, error: 0, threw: false } }, { run, platform: "darwin" });
  assert.equal(result.command.exit, 65); assert.equal(result.extraction, 5); assert.equal(result.caughtError, 1);
  assert.deepEqual(result.log.events, [{ test: 1, outcome: 1 }, { test: 1, outcome: 3 }]);
  assert.deepEqual(result.result.issues, [{ kind: "assertion-failure", code: null, severity: "error" }]);
  assert.equal(result.result.command.exit, 0); assert.equal(result.identity.executable, "c".repeat(64));
  assert(!JSON.stringify(result).includes("SECRET")); assert(!JSON.stringify(result).includes(f.privateRoot));
  assert.deepEqual(JSON.parse(readFileSync(join(f.output, "test-result-synopsis.json"))), result);
  const second = await retainPhase7(f, { run, platform: "darwin" }); assert.equal(second.reason, "synopsis-write-unavailable");
  assert.deepEqual(JSON.parse(readFileSync(join(f.output, "test-result-synopsis.json"))), result);
});

test("missing/unsupported/malformed metadata, private kinds and bounded-tool failures stay unavailable", async (t) => {
  const f = fixture(t); writeFileSync(join(f.privateRoot, "test.private"), "private failure output\n");
  const result = await retainPhase7({ ...f, command: { secret: "PRIVATE" }, extraction: -1, failure: 9000 }, { platform: "darwin" });
  assert.equal(result.result.status, "unavailable"); assert.equal(result.command.observed, false); assert.equal(result.extraction, 0); assert.equal(result.caughtError, 0);
  assert(!JSON.stringify(result).includes("PRIVATE"));
  const cases = [
    (cb) => cb(null, "{bad}"),
    (cb) => cb(null, JSON.stringify({ issues: { testFailureSummaries: { _values: [{ issueType: { _value: "SECRET" } }] } } })),
    (cb) => cb(Object.assign(new Error("SECRET"), { code: 65, signal: "SIGKILL" })),
  ];
  for (const invoke of cases) {
    const g = fixture(t); mkdirSync(join(g.privateRoot, "result.xcresult"));
    const value = await retainPhase7(g, { platform: "darwin", run: (_exe, _args, _opts, cb) => invoke(cb) });
    assert.equal(value.result.status, "unavailable"); assert(!JSON.stringify(value).includes("SECRET"));
  }
  const g = fixture(t); mkdirSync(join(g.privateRoot, "result.xcresult")); let calls = 0;
  assert.equal((await retainPhase7(g, { platform: "win32", run: () => calls++ })).result.reason, "unsupported-tool"); assert.equal(calls, 0);
});

test("linked roots/logs/results and over-budget result trees are not read by tooling", async (t) => {
  const f = fixture(t); const external = join(f.root, "external"); mkdirSync(external); writeFileSync(join(external, "test.private"), started);
  const linked = join(f.root, "link"); symlinkSync(external, linked, process.platform === "win32" ? "junction" : "dir"); let calls = 0;
  const result = await retainPhase7({ ...f, privateRoot: linked }, { platform: "darwin", run: () => calls++ });
  assert.equal(result.log.reason, "unsafe-root"); assert.equal(calls, 0);
  mkdirSync(join(external, "private")); writeFileSync(join(external, "private/test.private"), started);
  const ancestor = fixture(t);
  assert.equal((await retainPhase7({ ...ancestor, privateRoot: join(linked, "private") }, { platform: "darwin", run: () => calls++ })).log.reason, "unsafe-root");
  assert.equal(calls, 0);
  const g = fixture(t); symlinkSync(external, join(g.privateRoot, "result.xcresult"), process.platform === "win32" ? "junction" : "dir");
  assert.equal((await retainPhase7(g, { platform: "darwin", run: () => calls++ })).result.status, "unavailable"); assert.equal(calls, 0);
  const h = fixture(t), bundle = join(h.privateRoot, "result.xcresult"); mkdirSync(bundle);
  for (let i = 0; i < 257; i++) writeFileSync(join(bundle, String(i)), "");
  assert.equal((await retainPhase7(h, { platform: "darwin", run: () => calls++ })).result.status, "unavailable"); assert.equal(calls, 0);
});

test("invalid source identity and private command fields cannot enter the synopsis", async (t) => {
  const f = fixture(t); f.receipt = { source: "PRIVATE", runId: "PRIVATE", phase: 1000, driverBuild: { executableSha256: "PRIVATE" } };
  const result = await retainPhase7({ ...f, command: { observed: true, exit: 65, signal: 0, error: 0, threw: false, private: "PRIVATE" } });
  assert.equal(result.identity.source, null); assert.equal(result.identity.run, null); assert.equal(result.identity.executable, null);
  assert.equal(result.phase, null); assert.equal(result.command.observed, false); assert(!JSON.stringify(result).includes("PRIVATE"));
});

test("linked and over-bound private logs remain unavailable instead of contributing lifecycle events", async (t) => {
  const f = fixture(t), external = join(f.root, "external.log"); writeFileSync(external, started);
  // Home cannot create file symlinks. Exercise an actual junction there; Unix also tests a file symlink.
  const target = process.platform === "win32" ? join(f.root, "external-directory") : external;
  if (process.platform === "win32") mkdirSync(target);
  symlinkSync(target, join(f.privateRoot, "test.private"), process.platform === "win32" ? "junction" : "file");
  assert.equal((await retainPhase7(f)).log.reason, "unsafe-or-bounded-log");
  const g = fixture(t); writeFileSync(join(g.privateRoot, "test.private"), Buffer.alloc(16 * 1024 * 1024 + 1));
  assert.equal((await retainPhase7(g)).log.reason, "unsafe-or-bounded-log");
});

test("original phase7 selection/deadlines and oracle remain, with advisory retention before original cleanup", () => {
  const source = readFileSync(join(sourceRoot, "scripts/ios-native/axRequest.mjs"), "utf8");
  assert(source.includes('"-only-testing:maestro-driver-iosUITests/HSAXRequestQualificationTests", "-resultBundlePath", join(privateRoot, "result.xcresult")'));
  assert(source.includes('timeout: 1800000, log: "test.private"')); assert(source.includes('assert(receipt.controls && receipt.actualRequestTest, "Both actual XCTest controls must pass; zero tests cannot qualify.")'));
  assert(source.includes('assert.equal(receipt.capability.status, "observed", "Positive actual-app AX query/response stages are required.")'));
  assert(source.indexOf("await retainPhase7(") < source.indexOf("if (device)"));
  assert(source.includes('receipt.status = "failed"; receipt.failure = "owned-build-test-or-positive-stage-gate-failed"; process.exitCode = 1;'));
});

// Execute the actual runner, replacing only platform/native dependencies in a disposable CPU fixture.
// No xcrun, Xcode, app or simulator executable is launched by these controls.
function runner(t, source, mode) {
  const f = fixture(t), scripts = join(f.root, "scripts/ios-native"); mkdirSync(join(scripts, "ax-request"), { recursive: true });
  source = source.replaceAll('from "./artifact.mjs"', 'from "./native.fixture.mjs"').replaceAll('from "./ax-request/patch.mjs"', 'from "./native.fixture.mjs"');
  writeFileSync(join(scripts, "axRequest.mjs"), source);
  for (const file of ["ax-request/parse.mjs", "ax-request/result.mjs", "driverEvidence.mjs"])
    writeFileSync(join(scripts, file), readFileSync(join(sourceRoot, "scripts/ios-native", file)));
  writeFileSync(join(f.root, "bun.lock"), "fixture lock"); mkdirSync(join(f.root, "reports"));
  writeFileSync(join(scripts, "native.fixture.mjs"), `export const DRIVER_REF="3ff379997a4879b174458cbd58ecade5641e8609";
export const sha=()=>"0769349aecc7f83fb2729fba68c9583c3a51b324a0225485865dc064ccab48b4";
export const patchDriver=()=>({files:[{path:"fixture.swift"}]});
export function loadBuiltSimulator({receipt}){receipt.build={source:receipt.source,runId:receipt.runId,manifestSha256:"${"1".repeat(64)}",artifactSha256:"${"2".repeat(64)}"};return {app:"fixed-fixture.app"};}`);
  const preload = join(f.root, "preload.mjs");
  writeFileSync(preload, `import cp from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import {syncBuiltinESMExports} from 'node:module';
const root=${JSON.stringify(f.root)},mode=${JSON.stringify(mode)},calls=[];
const record=(value)=>{calls.push(value);fs.writeFileSync(path.join(root,'calls.json'),JSON.stringify(calls));};
Object.defineProperty(process,'platform',{value:'darwin'});Object.defineProperty(process,'arch',{value:'arm64'});
cp.spawnSync=(exe,args,opts)=>{let stdout='';
 if(exe==='git'){if(args[0]==='rev-parse')stdout=opts.cwd.includes('maestro-ios-xctest-runner')?'3ff379997a4879b174458cbd58ecade5641e8609':'${"a".repeat(40)}';else if(args[0]==='diff')stdout='maestro-ios-xctest-runner/maestro-driver-iosUITests/fixture.swift';}
 else if(exe==='xcrun'){if(args[0]==='--sdk')stdout='26.5';else if(args[1]==='list')stdout=JSON.stringify({devicetypes:[{name:'iPhone 17',identifier:'fixed-type'}]});else if(args[1]==='create')stdout='fixed-owned-device';else if(['shutdown','delete'].includes(args[1]))record({kind:args[1]});}
 else if(exe==='xcodebuild'){
  if(args[0]==='-version')stdout='Xcode 26.6\\nBuild version 17F113';
  else if(args.includes('build-for-testing')){
   const products=path.join(args[args.indexOf('-derivedDataPath')+1],'Build/Products');fs.mkdirSync(products,{recursive:true});fs.writeFileSync(path.join(products,'fixed.xctestrun'),'fixture');
   const binary=path.join(products,'Debug-iphonesimulator/maestro-driver-iosUITests-Runner.app/PlugIns/maestro-driver-iosUITests.xctest/maestro-driver-iosUITests');fs.mkdirSync(path.dirname(binary),{recursive:true});fs.writeFileSync(binary,'fixture');
   const resolution=path.join(root,'reports/ax-driver-source/maestro-ios-xctest-runner/maestro-driver-ios.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved');fs.mkdirSync(path.dirname(resolution),{recursive:true});fs.writeFileSync(resolution,'fixture');
  }else if(args[0]==='test-without-building'){
   record({kind:'test',args,timeout:opts.timeout,maxBuffer:opts.maxBuffer});
   const bundle=args[args.indexOf('-resultBundlePath')+1];fs.mkdirSync(bundle,{recursive:true});fs.writeFileSync(path.join(bundle,'Info.plist'),'fixture');
   let log=${JSON.stringify(started + failed)};
   if(mode!=='failed'){
    log=${JSON.stringify(started.replace("started.", "passed (0.01 seconds).") + "Test Case '-[driver.HSAXRequestQualificationTests test10ActualDeviceInfoRequest]' passed (0.01 seconds).\n")};
    const stages=[[1,0,100,3],[2,0,0,0],[2,1,0,0],[3,1,200,1],[7,1,0,0],[1,1,100,3]];
    log+=stages.map(([stage,edge,target,role],seq)=>'HS_AX_STAGE_V1 '+JSON.stringify({v:1,seq,pid:100,request:3,stage,edge,error:0,target,role,wallUs:100000+seq,monoUs:1000+seq})).join('\\n')+'\\n';
   }
   if(mode!=='missing-log')fs.writeSync(opts.stdio[1],log);
   if(mode==='write-failed')fs.writeFileSync(path.join(root,'reports/ax-request-evidence/test-result-synopsis.json'),'preserved');
   return {status:mode==='failed'?65:0,stdout:'',error:undefined,signal:null};
  }else throw new Error('unexpected xcode fixture command');
 }else throw new Error('unexpected native fixture command');
 return {status:0,stdout,error:undefined,signal:null};};
cp.execFile=(exe,args,opts,cb)=>{record({kind:'metadata',timeout:opts.timeout,maxBuffer:opts.maxBuffer});if(mode==='metadata-failed')cb(Object.assign(new Error('SECRET'),{code:'EACCES'}));else cb(null,${JSON.stringify(JSON.stringify(legacy))},'SECRET');};
syncBuiltinESMExports();`);
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, join(scripts, "axRequest.mjs")], { encoding: "utf8", timeout: 20000, env: { ...process.env, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" } });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.stderr, "");
  const out = join(f.root, "reports/ax-request-evidence");
  return { ...f, result, out, receipt: JSON.parse(readFileSync(join(out, "receipt.json"))), calls: JSON.parse(readFileSync(join(f.root, "calls.json"))) };
}

test("actual phase7 failure path preserves failed oracle and retains typed synopsis before cleanup", (t) => {
  const file = process.env.AX_RESULT_BASELINE === "1" ? "fixtures/ax-phase7-baseline-9b.mjs.fixture" : "axRequest.mjs";
  const r = runner(t, readFileSync(join(sourceRoot, "scripts/ios-native", file), "utf8"), "failed");
  assert.equal(r.result.status, 1); assert.equal(r.receipt.status, "failed"); assert.equal(r.receipt.phase, 7);
  assert.equal(r.receipt.capability.status, "unavailable"); assert.equal(r.receipt.observation.invalid, 0);
  const calls = r.calls.filter((x) => x.kind === "test"); assert.equal(calls.length, 1); assert.equal(calls[0].timeout, 1800000); assert.equal(calls[0].maxBuffer, 16 * 1024 * 1024);
  assert.equal(r.calls.filter((x) => x.kind === "shutdown").length, 1); assert.equal(r.calls.filter((x) => x.kind === "delete").length, 1);
  assert(existsSync(join(r.out, "test-result-synopsis.json")), "actual phase7 failure lacks the allocated typed result synopsis");
  const synopsis = JSON.parse(readFileSync(join(r.out, "test-result-synopsis.json")));
  assert.equal(synopsis.command.exit, 65); assert.equal(synopsis.extraction, 5); assert.equal(synopsis.caughtError, 1);
  assert.deepEqual(synopsis.log.events, [{ test: 1, outcome: 1 }, { test: 1, outcome: 3 }]); assert.equal(synopsis.result.issues[0].kind, "assertion-failure");
  assert(r.calls.findIndex((x) => x.kind === "metadata") < r.calls.findIndex((x) => x.kind === "shutdown"));
  assert(!JSON.stringify(r.receipt).includes("SECRET"));
});

test("actual runner retains original success/failure and command arguments against the pinned baseline", (t) => {
  const baseline = readFileSync(join(sourceRoot, "scripts/ios-native/fixtures/ax-phase7-baseline-9b.mjs.fixture"), "utf8");
  const current = readFileSync(join(sourceRoot, "scripts/ios-native/axRequest.mjs"), "utf8");
  for (const mode of ["passed", "failed"]) {
    const old = runner(t, baseline, mode), now = runner(t, current, mode);
    assert.equal(now.result.status, old.result.status); const next = { ...now.receipt }; delete next.testResultSynopsis;
    next.artifacts = next.artifacts.filter((a) => a.path !== "test-result-synopsis.json"); assert.deepEqual(next, old.receipt);
    const oldCall = old.calls.find((c) => c.kind === "test"), newCall = now.calls.find((c) => c.kind === "test");
    // Only the fresh fixture root differs. Every original argument and deadline otherwise agrees.
    assert.deepEqual({ ...newCall, args: newCall.args.map((x) => x.replaceAll(now.root, "ROOT")) }, { ...oldCall, args: oldCall.args.map((x) => x.replaceAll(old.root, "ROOT")) });
  }
});

test("actual runner keeps original oracle when metadata/write retention fails and distinguishes empty output", (t) => {
  const source = readFileSync(join(sourceRoot, "scripts/ios-native/axRequest.mjs"), "utf8");
  for (const mode of ["metadata-failed", "write-failed"]) {
    const r = runner(t, source, mode); assert.equal(r.result.status, 0); assert.equal(r.receipt.status, "passed");
    assert.equal(r.receipt.capability.status, "observed");
    if (mode === "metadata-failed") { assert.equal(r.receipt.testResultSynopsis.result.status, "unavailable"); assert.equal(r.receipt.testResultSynopsis.result.command.error, 3); }
    else { assert.equal(r.receipt.testResultSynopsis.reason, "synopsis-write-unavailable"); assert.equal(readFileSync(join(r.out, "test-result-synopsis.json"), "utf8"), "preserved"); }
  }
  const r = runner(t, source, "missing-log");
  // command opens the log before launch, so missing output is an empty valid file, never missing execution proof.
  assert.equal(r.result.status, 1); assert.equal(r.receipt.phase, 8); assert.deepEqual(r.receipt.testResultSynopsis.log.events, []);
  assert.equal(r.receipt.testResultSynopsis.command.exit, 0); assert.equal(r.receipt.testResultSynopsis.extraction, 5);
});
