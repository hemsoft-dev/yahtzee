import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, lstatSync } from "node:fs";
import { join } from "node:path";

export const DRIVER_REF = "3ff379997a4879b174458cbd58ecade5641e8609";
export const PINS = {
  "Utilities/AXClientProxy.h": "00cbeb0e617059590b7cc2f519aa96fd326e55b34c7a2c36f0a7988da947a833",
  "Utilities/AXClientProxy.m": "286fc0cc17ce0217fca0647fd2b509d0a16d7eaa20490850a718beb50d94dc88",
  "Categories/XCUIApplication+Helper.m": "5dd2ea6eb994a652d2f98730277f18f1915d4fbeb1efde43307f962d0facae5b",
  "Routes/Handlers/DeviceInfoHandler.swift": "9a6253119f7b9d1be74c4001c8ec11b09588e094be0ee949cb84d9ffec213632",
  "maestro_driver_iosUITests.swift": "c6055665f7fed629f861d8684697518248b468a15d4931c352b7208ecc940cbe",
};
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function replaceOnce(source, from, to) {
  assert.equal(source.split(from).length, 2, "Expected one pinned source insertion point.");
  return source.replace(from, to);
}
export function transform(path, original, additions) {
  let value = original;
  if (path === "Utilities/AXClientProxy.h") value += additions.header;
  if (path === "Utilities/AXClientProxy.m") {
    value = replaceOnce(value, "return [AXClient activeApplications];", "return HSAXForwardActiveApplications(AXClient);");
    value += additions.implementation;
  }
  if (path === "Categories/XCUIApplication+Helper.m") {
    value = replaceOnce(value, '#import "AXClientProxy.h"', '#import "AXClientProxy.h"');
    value = replaceOnce(value, '[result addObject:appInfo.copy];', 'HSAXObserveApp(pid, appInfo[@"bundleId"]);\n        [result addObject:appInfo.copy];');
  }
  if (path === "Routes/Handlers/DeviceInfoHandler.swift") {
    value = replaceOnce(value, '        do {', '        let hsRequest = HSAXBeginRequest()\n        defer { HSAXEndRequest(hsRequest) }\n        do {');
    value = replaceOnce(value, '            return HTTPResponse(statusCode: .ok, body: responseBody)', '            HSAXStage(7, 1, 0)\n            return HTTPResponse(statusCode: .ok, body: responseBody)');
    value = replaceOnce(value, '        } catch let error {', '        } catch let error {\n            HSAXStage(7, 2, 4)');
  }
  if (path === "maestro_driver_iosUITests.swift") value += additions.tests;
  return value;
}
export function patchDriver(source) {
  const directory = join(source, "maestro-driver-iosUITests");
  const additions = Object.fromEntries([["header", "Observation.h.inc"], ["implementation", "Observation.m.inc"], ["tests", "RequestTests.swift.inc"]]
    .map(([key, file]) => [key, readFileSync(join(import.meta.dirname, file), "utf8")]));
  const prepared = Object.entries(PINS).map(([path, expected]) => {
    const file = join(directory, path), stat = lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size < 128 * 1024);
    const bytes = readFileSync(file); assert.equal(sha(bytes), expected, `Pinned driver source changed: ${path}`);
    const patched = transform(path, bytes.toString("utf8"), additions);
    return { path, file, original: expected, patched, sha256: sha(patched) };
  });
  for (const row of prepared) writeFileSync(row.file, row.patched);
  return { source: DRIVER_REF, files: prepared.map(({ path, original, sha256 }) => ({ path, original, sha256 })),
    addedTestOnly: true, deadlinesChanged: false, privateAPIsAdded: false };
}
