const assert = require('node:assert/strict');
const braces = require('braces');
const { sprintf } = require('sprintf-js');
const forge = require('node-forge');
assert.throws(() => braces('{'.repeat(4000) + 'a' + '}'.repeat(4000)), { name: 'SyntaxError', message: /safe depth/ });
assert.deepEqual(braces.expand('a{b,c}'), ['ab', 'ac']);
assert.throws(() => braces('('.repeat(4000) + 'a' + ')'.repeat(4000)), /safe depth/);
for (const operation of ['compile', 'expand', 'stringify']) {
  let ast = { type: 'text', value: 'a' };
  for (let index = 0; index < 4000; index++) ast = { type: 'root', nodes: [ast] };
  assert.throws(() => braces[operation](ast), /safe depth/);
}
let nestedValue = 'a';
for (let index = 0; index < 4000; index++) nestedValue = [nestedValue];
assert.throws(() => braces.expand({ type: 'root', nodes: [{ type: 'text', value: nestedValue }] }), /safe depth/);
assert.throws(() => require('braces/lib/utils').flatten(nestedValue), /safe depth/);
for (const cyclic of [true, false]) {
  const node = { type: 'text', nodes: [] };
  if (cyclic) node.parent = node;
  else {
    let parent = node;
    for (let index = 0; index < 4000; index++) parent = parent.parent = { type: 'text', nodes: [] };
  }
  assert.throws(() => braces.expand(node), /safe depth/);
  assert.throws(() => braces.expand({ type: 'root', nodes: [node] }), /safe depth/);
  assert.throws(() => braces.expand({ type: 'root', nodes: [{ ...node, nodes: [{ type: 'root', nodes: [] }] }] }), /safe depth/);
}
for (const kind of ['f', 'e', 'g']) assert.doesNotThrow(() => sprintf(`%.1000000000${kind}`, 1));
assert.equal(sprintf('%.2f', 1.234), '1.23');
const pair = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 3 });
const md = forge.md.sha256.create();
md.update('fixture');
const a=forge.asn1;const digestInfo=a.create(a.Class.UNIVERSAL,a.Type.SEQUENCE,true,[a.create(a.Class.UNIVERSAL,a.Type.SEQUENCE,true,[a.create(a.Class.UNIVERSAL,a.Type.OID,false,a.oidToDer(forge.oids.sha256).getBytes()),a.create(a.Class.UNIVERSAL,a.Type.NULL,false,''),a.create(a.Class.UNIVERSAL,a.Type.NULL,false,'')]),a.create(a.Class.UNIVERSAL,a.Type.OCTETSTRING,false,md.digest().getBytes())]);
const bad=a.toDer(digestInfo).getBytes();const signature=pair.privateKey.sign(bad,'NONE');
assert.throws(() => pair.publicKey.verify(md.digest().getBytes(), signature), /valid RSASSA/);
for (const parameter of [a.create(a.Class.UNIVERSAL, a.Type.NULL, false, 'garbage'),
  a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, 'garbage'),
  a.create(a.Class.CONTEXT_SPECIFIC, a.Type.NULL, false, '')]) {
  const malformed = a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, [
    a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, [
      a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer(forge.oids.sha256).getBytes()), parameter]),
    a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, md.digest().getBytes()),
  ]);
  const malformedSignature = pair.privateKey.sign(a.toDer(malformed).getBytes(), 'NONE');
  assert.throws(() => pair.publicKey.verify(md.digest().getBytes(), malformedSignature), /valid RSASSA/);
}
assert.equal(pair.publicKey.verify(md.digest().getBytes(), pair.privateKey.sign(md)), true);
console.log('Security patch regressions passed.');
