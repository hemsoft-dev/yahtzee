import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { readCapturePng } from "../ios-release/png.mjs";

const METADATA = new Set(["cHRM", "gAMA", "iCCP", "sRGB", "cICP", "mDCv", "cLLi", "pHYs"]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function uprightExif(data) {
  assert(data.length >= 8, "Invalid capture EXIF.");
  const endian = data.toString("ascii", 0, 2); assert(endian === "MM" || endian === "II", "Invalid EXIF byte order.");
  const short = (offset) => endian === "MM" ? data.readUInt16BE(offset) : data.readUInt16LE(offset);
  const long = (offset) => endian === "MM" ? data.readUInt32BE(offset) : data.readUInt32LE(offset);
  assert.equal(short(2), 42, "Invalid EXIF header.");
  const offset = long(4); assert(offset + 2 <= data.length, "Invalid EXIF directory.");
  const count = short(offset); assert(offset + 2 + count * 12 + 4 <= data.length, "Truncated EXIF directory.");
  for (let index = 0; index < count; index++) {
    const field = offset + 2 + index * 12;
    if (short(field) !== 0x112) continue;
    assert(short(field + 2) === 3 && long(field + 4) === 1 && short(field + 8) === 1, "Capture orientation requires explicit normalization.");
  }
}

/** Export a new RGB file without compositing, cropping, resizing or changing samples. */
export function rgbCapture(source, expected) {
  const { image, chunks: original } = readCapturePng(source), header = original[0].data;
  const { width, height } = image;
  assert(width === expected.width && height === expected.height, "Capture dimensions differ from the selected device profile.");
  assert(header[8] === 8 && [2, 6].includes(header[9]), "Expected an 8-bit RGB or RGBA native capture.");
  assert(!original.some((chunk) => chunk.type === "sBIT"), "Significant-bit metadata needs a separate reviewed conversion.");
  for (const chunk of original.filter((item) => item.type === "eXIf")) uprightExif(chunk.data);
  const metadata = original.filter((chunk) => METADATA.has(chunk.type));
  assert(new Set(metadata.map((chunk) => chunk.type)).size === metadata.length, "Duplicate color metadata.");
  assert(!(metadata.some((chunk) => chunk.type === "sRGB") && metadata.some((chunk) => chunk.type === "iCCP")), "Conflicting color metadata.");
  assert(metadata.every((chunk) => original.indexOf(chunk) < original.findIndex((item) => item.type === "IDAT")), "Color metadata follows image data.");
  for (let index = 3; index < image.data.length; index += 4) assert.equal(image.data[index], 255, "Capture contains transparent pixels; compositing is not permitted.");
  const { chunks: encoded } = readCapturePng(PNG.sync.write({ width, height, data: image.data }, { colorType: 2 }));
  const bytes = Buffer.concat([source.subarray(0, 8), encoded[0].bytes, ...metadata.map((chunk) => chunk.bytes), ...encoded.slice(1).map((chunk) => chunk.bytes)]);
  const { image: verified } = readCapturePng(bytes);
  assert.equal(verified.alpha, false); assert(verified.data.equals(image.data), "RGB export changed color samples.");
  return { bytes, sourceSha256: hash(source), sha256: hash(bytes), pixelSha256: hash(image.data), width, height,
    preservedMetadata: metadata.map((chunk) => ({ type: chunk.type, sha256: hash(chunk.data) })),
    omittedMetadata: [...new Set(original.filter((chunk) => !METADATA.has(chunk.type) && !["IHDR", "IDAT", "IEND"].includes(chunk.type)).map((chunk) => chunk.type))] };
}
