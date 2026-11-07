import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("comparison-only build rejects pin drift, extra classes and ambiguous JAR entries", () => {
  const script = fileURLToPath(new URL("./comparison/build.py", import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), "comparison-build-"));
  const code = String.raw`
import argparse, importlib.util, json, pathlib, sys, zipfile
sys.dont_write_bytecode = True
spec=importlib.util.spec_from_file_location('comparison_build',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
r=pathlib.Path(sys.argv[2])
assert m.numeric_identity('42391599147')=='42391599147'
assert m.numeric_identity('secret-like\nvalue') is None
assert m.numeric_identity('9'*21) is None
assert m.source_identity({'pull_request':{'head':{'sha':'a'*40}}},'b'*40)=='a'*40
assert m.source_identity({'pull_request':{}},'b'*40) is None
assert m.source_identity([], 'b'*40) is None
assert m.source_identity({},'b'*40)=='b'*40
assert m.source_identity({'pull_request':{'head':{'sha':'secret-like'}}},'b'*40) is None
def rejects(f):
 try: f()
 except AssertionError: return
 raise AssertionError('missing rejection')
rejects(lambda:m.transform(b'unpinned'))
fixture=('prefix\n'+m.OLD+'\nsuffix').encode()
m.SOURCE_SHA=m.sha(fixture)
patched=m.transform(fixture)
assert patched.decode().replace(m.NEW,m.OLD).encode()==fixture
assert patched.count(b'updateRectangleCreation')==1
classes=r/'classes';target=classes/m.CLASS;target.parent.mkdir(parents=True);target.write_bytes(b'candidate')
original=r/'original.jar'
with zipfile.ZipFile(original,'x') as z:
 z.writestr(m.CLASS,b'original');z.writestr('other.class',b'unchanged');z.writestr('resource',b'unchanged-resource')
proof=m.rewrite(original,r/'patched.jar',classes)
with zipfile.ZipFile(r/'patched.jar') as z:
 assert z.read(m.CLASS)==b'candidate' and z.read('other.class')==b'unchanged' and z.read('resource')==b'unchanged-resource'
assert proof['changedEntries']==[m.CLASS] and proof['unchangedEntries']==2
(classes/'Unexpected.class').write_bytes(b'not-allowed')
rejects(lambda:m.rewrite(original,r/'extra.jar',classes))
(classes/'Unexpected.class').unlink()
for n,names in [('missing',['other']),('duplicate',[m.CLASS,m.CLASS])]:
 p=r/(n+'.jar')
 with zipfile.ZipFile(p,'x') as z:
  for name in names:z.writestr(name,b'fixture')
 rejects(lambda:m.rewrite(p,r/(n+'-output.jar'),classes))
# A bad installed input must fail before compilation, retain a finite failure
# proof, preserve that input and never try a second build.
cli=r/'cli';(cli/'lib').mkdir(parents=True)
bad=cli/'lib/image-comparison-4.4.0.jar';bad.write_bytes(b'not-the-pinned-jar')
try:
 m.build(argparse.Namespace(cli_root=str(cli),java_home=str(r/'absent-java'),output=str(r/'failure'),source_archive=None,observed_client_proof=None))
except AssertionError: pass
else: raise AssertionError('bad JAR admitted')
assert json.loads((r/'failure/proof.json').read_text())['status']=='failed'
assert bad.read_bytes()==b'not-the-pinned-jar'
print('COMPARISON_BUILD_CONTROLS_PASS')
`;
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", code, script, directory], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /COMPARISON_BUILD_CONTROLS_PASS/);
});

test("every existing comparator-using route requires the patch controls and retains identity", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/quality.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  for (const job of ["native", "native-modal", "native-settle"]) {
    const start = workflow.indexOf(`\n  ${job}:\n`);
    assert(start > 0);
    const next = /\n {2}\S[^:\n]*:\n/.exec(workflow.slice(start + 3));
    const body = workflow.slice(start, next ? start + 3 + next.index : undefined);
    assert.match(body, /python3 scripts\/ios-native\/comparison\/build.py/);
    assert.match(body, /reports\/comparison-build\/proof.json/);
    assert(!body.includes("continue-on-error:"));
  }
  assert.match(workflow, /--observed-client-proof reports\/\.settle-cli\/staging-proof.json/);
});
