import assert from "node:assert/strict";
import test from "node:test";
import { crc32 } from "node:zlib";
import { PNG } from "pngjs";
import { rgbCapture } from "./image.mjs";

const size = { width: 2, height: 1 };
function chunk(type, data) {
  const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length);
  bytes.write(type, 4); data.copy(bytes, 8); bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}
function source(alpha = 255) {
  return PNG.sync.write({ ...size, data: Buffer.from([10, 20, 30, alpha, 40, 50, 60, 255]) }, { colorType: 6 });
}
const insert = (png, bytes) => Buffer.concat([png.subarray(0, 33), bytes, png.subarray(33)]);

test("RGB export preserves source bytes, samples and color metadata without alpha", () => {
  const gamma = Buffer.alloc(4); gamma.writeUInt32BE(45455);
  const tagged = insert(source(), Buffer.concat([chunk("sRGB", Buffer.from([0])), chunk("gAMA", gamma)]));
  const original = Buffer.from(tagged), result = rgbCapture(tagged, size), decoded = PNG.sync.read(result.bytes);
  assert(tagged.equals(original)); assert.equal(decoded.alpha, false); assert.equal(result.bytes[25], 2);
  assert(decoded.data.equals(PNG.sync.read(tagged).data)); assert.equal(decoded.gamma, 0.45455);
  assert.deepEqual(result.preservedMetadata.map((item) => item.type), ["sRGB", "gAMA"]);
  assert.match(result.sha256, /^[a-f0-9]{64}$/); assert.notEqual(result.sha256, result.sourceSha256);
  assert(rgbCapture(tagged, size).bytes.equals(result.bytes));
});
test("transparent pixels are refused rather than silently composited", () => {
  for (const alpha of [0, 1, 127, 254]) assert.throws(() => rgbCapture(source(alpha), size), /compositing is not permitted/);
});
test("wrong sizes, damaged chunks and trailing bytes fail before an export", () => {
  assert.throws(() => rgbCapture(source(), { width: 1, height: 1 }), /selected device profile/);
  const damaged = source(); damaged[damaged.length - 1] ^= 1;
  assert.throws(() => rgbCapture(damaged, size), /CRC/);
  assert.throws(() => rgbCapture(source().subarray(0, -1), size), /Truncated|framing/);
  assert.throws(() => rgbCapture(Buffer.concat([source(), Buffer.from([0])]), size), /framing/);
  const badText = chunk("tEXt", Buffer.from("capture\0draft")); badText[badText.length - 1] ^= 1;
  assert.throws(() => rgbCapture(insert(source(), badText), size), /tEXt CRC/);
});
test("ambiguous precision, duplicate color chunks and duplicate headers are refused", () => {
  assert.throws(() => rgbCapture(insert(source(), chunk("sBIT", Buffer.from([8, 8, 8, 8]))), size), /Significant-bit/);
  const profile = chunk("sRGB", Buffer.from([0]));
  assert.throws(() => rgbCapture(insert(source(), Buffer.concat([profile, profile])), size), /Duplicate color/);
  assert.throws(() => rgbCapture(insert(source(), source().subarray(8, 33)), size), /Duplicate header or end/);
});
test("rotated EXIF cannot silently lose its orientation on export", () => {
  const exif = Buffer.alloc(26); exif.write("MM"); exif.writeUInt16BE(42, 2); exif.writeUInt32BE(8, 4);
  exif.writeUInt16BE(1, 8); exif.writeUInt16BE(0x112, 10); exif.writeUInt16BE(3, 12);
  exif.writeUInt32BE(1, 14); exif.writeUInt16BE(6, 18);
  assert.throws(() => rgbCapture(insert(source(), chunk("eXIf", exif)), size), /explicit normalization/);
  exif.writeUInt16BE(1, 18);
  const result = rgbCapture(insert(source(), chunk("eXIf", exif)), size);
  assert.deepEqual(result.omittedMetadata, ["eXIf"]);
});
