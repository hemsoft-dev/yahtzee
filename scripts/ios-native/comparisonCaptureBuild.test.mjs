import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("capture/profile transforms are pinned, reversible and limited to the admitted operation", () => {
  const directory = fileURLToPath(new URL("./comparison/", import.meta.url));
  const code = String.raw`
import pathlib, importlib.util, sys
sys.dont_write_bytecode=True
root=pathlib.Path(sys.argv[1]);sys.path.insert(0,str(root))
import build, replay
source=('prefix\n'+build.CAPTURE_POINT+'\n        groupRegions();\n        List<Rectangle> rectangles = new ArrayList<>();\n'+build.OLD+'\n        return mergeRectangles(mergeRectangles(rectangles));\nsuffix').encode()
build.SOURCE_SHA=build.sha(source)
plain=build.transform(source)
captured=build.transform(source,True)
assert build.CAPTURE_CALL not in plain.decode()
assert captured.decode().count('QualificationComparisonCapture.snapshot')==1
assert captured.decode().replace(build.CAPTURE_CALL,build.CAPTURE_POINT).replace(build.NEW,build.OLD).encode()==source
profiled=replay.profiled(captured)
assert profiled.decode().count('ProfileHooks.measure')==2
assert 'ProfileHooks.group' in profiled.decode() and 'ProfileHooks.end(3' in profiled.decode()
for value in [b'wrong source',source+b'\nchanged']:
 try:build.transform(value,True)
 except AssertionError:pass
 else:raise AssertionError('unpinned source accepted')
print('PINNED_CAPTURE_PROFILE_TRANSFORMS_PASS')
`;
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", code, directory], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PINNED_CAPTURE_PROFILE_TRANSFORMS_PASS/);
});
