import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

test("source-copy packaging rejects unsafe archives, changed pins and missing family members", () => {
  const directory = fileURLToPath(new URL(`../../reports/.settle-build-test-${randomUUID()}/`, import.meta.url));
  mkdirSync(directory, { recursive: true });
  const stage = fileURLToPath(new URL("./settle/stage.py", import.meta.url));
  const code = String.raw`
import importlib.util, json, pathlib, stat, sys, zipfile
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('owned_stage', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
r = pathlib.Path(sys.argv[2])
def rejects(f, label='unknown'):
 try: f()
 except AssertionError: return
 raise AssertionError('Expected bounded rejection '+label)
rejects(lambda: m.transform(b'not pinned source'))
rejects(lambda: m.transform(b'not pinned driver',m.DRIVER_SHA,m.DRIVER_REPLACEMENTS))
rejects(lambda: m.transform(b'not pinned image source',m.IMAGE_SHA,m.IMAGE_REPLACEMENTS))
for i, name in enumerate(['../escape', '/absolute', 'C:/drive', 'back\\slash', 'control\nname']):
 p = r / ('bad-'+str(i)+'.zip')
 with zipfile.ZipFile(p, 'x') as z: z.writestr(name, b'fixture')
 if '\\' in name:
  # Windows ZipInfo normalizes its host separator. Restore the malicious entry bytes.
  p.write_bytes(p.read_bytes().replace(name.replace('\\','/').encode(),name.encode()))
 rejects(lambda: m.extract(p,r/('out-'+str(i)),1024),str(i))
 assert not (r/('out-'+str(i))).exists()
p = r/'link.zip'
with zipfile.ZipFile(p, 'x') as z:
 info=zipfile.ZipInfo('linked'); info.external_attr=(stat.S_IFLNK|0o777)<<16; z.writestr(info,b'elsewhere')
rejects(lambda: m.extract(p,r/'linked-out',1024))
original=r/'original.jar'
with zipfile.ZipFile(original,'x') as z:
 z.writestr('maestro/Maestro.class',b'old')
 z.writestr('maestro/Other.class',b'unchanged')
 z.writestr('resource.zip',b'unchanged-native-resource')
classes=r/'classes'; (classes/'maestro/drivers').mkdir(parents=True); (classes/'maestro/utils').mkdir()
(classes/'maestro/Maestro.class').write_bytes(b'observed')
(classes/'maestro/drivers/IOSDriver.class').write_bytes(b'observed-driver')
(classes/'maestro/utils/ScreenshotUtils.class').write_bytes(b'observed-image-source')
(classes/'maestro/QualificationSettleObservation.class').write_bytes(b'observer')
(classes/'maestro/QualificationSettleControls.class').write_bytes(b'must-not-publish')
(classes/'maestro/Marker.class').write_bytes(b'must-not-publish')
proof=m.rewrite_client(original,r/'observed.jar',classes)
with zipfile.ZipFile(r/'observed.jar') as z:
 assert z.read('maestro/Other.class')==b'unchanged'
 assert z.read('resource.zip')==b'unchanged-native-resource'
 assert z.read('maestro/drivers/IOSDriver.class')==b'observed-driver'
 assert z.read('maestro/utils/ScreenshotUtils.class')==b'observed-image-source'
 assert not any('Controls' in n or 'Marker' in n for n in z.namelist())
 assert proof['otherEntriesByteIdentical']==2
with zipfile.ZipFile(r/'missing-family.jar','x') as z:
 z.writestr('maestro/Maestro.class',b'old')
 z.writestr('maestro/Maestro$missing.class',b'old')
rejects(lambda: m.rewrite_client(r/'missing-family.jar',r/'must-fail.jar',classes))
print(json.dumps({'controls':'passed','unsafePaths':7,'testClassesExcluded':True,'nativeBytesPreserved':True}))
`;
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", code, stage, directory], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).nativeBytesPreserved, true);
});
