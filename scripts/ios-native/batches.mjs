import assert from "node:assert/strict";

/** Split only our bounded, single-line authored YAML. Preserve every command exactly once. */
export function batchAuthoredFlow(yaml) {
  assert.equal(typeof yaml, "string", "Authored flow must be text.");
  assert(yaml.length <= 262144 && yaml.endsWith("\n") && !yaml.includes("\r"), "Authored flow must be bounded LF text.");
  const [appId, separator, ...lines] = yaml.split("\n");
  assert(/^appId: "[A-Za-z0-9.-]+"$/.test(appId) && separator === "---", "Authored flow must have one app header.");
  lines.pop();
  assert(lines.length > 0 && lines.every((line) => /^- [A-Za-z][A-Za-z0-9]*(?:: .+)?$/.test(line)), "Only single-line authored commands can be batched.");
  const batches = [];
  for (let offset = 0; offset < lines.length; offset += 8) {
    batches.push(`${appId}\n---\n${lines.slice(offset, offset + 8).join("\n")}\n`);
  }
  return batches;
}

/** Await each batch on the same session. Never replay or continue after an uncertain failure. */
export async function runAuthoredFlow(io, yaml) {
  for (const batch of batchAuthoredFlow(yaml)) await io.runFlow(batch);
}
