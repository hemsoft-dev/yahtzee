import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { installNativeCancellation } from "./nativeCancelBuild.mjs";
const sourceRoot = resolve(import.meta.dirname, "../..");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "native-cancel-build-"));
  t.after(() => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert(root.includes("native-cancel-build-")); rmSync(root, { recursive: true }); });
  for (const path of ["apps/mobile/ios/App.xcodeproj", "apps/mobile/node_modules/react-native/React/Fabric/Mounting/ComponentViews/ScrollView", "apps/mobile/node_modules/react-native/React/CoreModules", "apps/mobile/node_modules/react-native/React/Fabric/Utils", "apps/mobile/node_modules/react-native/React/Fabric/Mounting/ComponentViews/View", "apps/mobile/node_modules/react-native/Libraries/Components/Pressable", "scripts/ios-native/native-cancel", "output"])
    mkdirSync(join(root, path), { recursive: true });
  const rn = join(root, "apps/mobile/node_modules/react-native");
  writeFileSync(join(rn, "package.json"), JSON.stringify({ version: "0.86.3" }));
  for (const path of ["Libraries/Components/Pressable/Pressable.js", "React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.h", "React/Fabric/RCTSurfaceTouchHandler.mm", "React/Fabric/Mounting/ComponentViews/ScrollView/RCTEnhancedScrollView.mm", "React/CoreModules/RCTAlertController.mm", "React/CoreModules/RCTAlertManager.mm", "React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm", "React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.h", "React/Fabric/Mounting/ComponentViews/ScrollView/RCTEnhancedScrollView.h", "React/Fabric/Utils/RCTGenericDelegateSplitter.mm", "React/Fabric/Utils/RCTGenericDelegateSplitter.h", "React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm"])
    copyFileSync(join(sourceRoot, "apps/mobile/node_modules/react-native", path), join(rn, path));
  for (const name of ["NativeCancelObserver.mm", "RuntimeHooks.h", "ForwardingControl.mm", "inject.rb", "NativeModalObserver.mm", "ModalWindowRuntime.h", "ModalForwardingControl.mm", "NativeScrollObserver.mm", "NativeScrollObserver.h", "ScrollReceiverRuntime.h", "ScrollForwardingControl.mm", "ResetTargetRuntime.h"])
    copyFileSync(join(sourceRoot, "scripts/ios-native/native-cancel", name), join(root, "scripts/ios-native/native-cancel", name));
  const ios = join(root, "apps/mobile/ios"), output = join(root, "output"); writeFileSync(join(ios, "App.xcodeproj/project.pbxproj"), "fixture project");
  const calls = [];
  const run = (exe, args, options) => {
    calls.push({ exe, args, options });
    if (exe === "ruby") return '{"added":true,"sourceCount":3}';
    if (exe.endsWith("forwarding-control")) return "native-cancel-forwarding-control:pass";
    if (exe.endsWith("scroll-control")) return "native-scroll-forwarding-control:pass";
    if (exe.endsWith("modal-control")) return "native-modal-forwarding-control:pass";
    return "";
  };
  return { root, rn, ios, output, calls, run };
}
test("simulator installation checks pinned source, requires its control and copies exact observer bytes", (t) => {
  const f = fixture(t), receipt = installNativeCancellation(f);
  assert.equal(receipt.forwardingControl, "passed"); assert.equal(receipt.generatedSourceCount, 3); assert.equal(receipt.modalForwardingControl, "passed");
  assert.equal(receipt.loadedRNImage, "unattested"); assert.equal(f.calls.length, 7);
  assert.equal(receipt.scrollForwardingControl, "passed");
  assert.deepEqual(f.calls[0].args.slice(0, 6), ["--sdk", "macosx", "clang++", "-fobjc-arc", "-framework", "Foundation"]);
  assert.equal(f.calls[1].options.timeout, 10000); assert.equal(f.calls[3].options.timeout, 10000); assert.equal(f.calls[6].exe, "ruby");
  const before = readFileSync(join(f.root, "scripts/ios-native/native-cancel/NativeCancelObserver.mm"));
  assert(before.equals(readFileSync(join(f.ios, "NativeDiagnostics/NativeCancelObserver.mm"))));
  assert.throws(() => installNativeCancellation(f), /Existing generated/);
});

test("scroll forwarding failure and pinned receiver drift stop before generated injection", (t) => {
  const f = fixture(t);
  const run = (exe, args, options) => exe.endsWith("scroll-control") ? "failed scroll control" : f.run(exe, args, options);
  assert.throws(() => installNativeCancellation({ ...f, run }), /native-scroll-forwarding-control:pass/);
  assert.equal(existsSync(join(f.ios, "NativeDiagnostics")), false); assert(!f.calls.some((c) => c.exe === "ruby"));
  const g = fixture(t); writeFileSync(join(g.rn, "React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm"), "changed receiver");
  assert.throws(() => installNativeCancellation(g), /source contract moved/); assert.equal(g.calls.length, 0);
});
test("failed modal forwarding or window-shape control cannot install either observer", (t) => {
  const f = fixture(t);
  const run = (exe, args, options) => exe.endsWith("modal-control") ? "failed modal control" : f.run(exe, args, options);
  assert.throws(() => installNativeCancellation({ ...f, run }), /native-modal-forwarding-control:pass/);
  assert.equal(existsSync(join(f.ios, "NativeDiagnostics")), false); assert(!f.calls.some((c) => c.exe === "ruby"));
});
test("source drift fails before generated writes or compiler invocation", (t) => {
  const f = fixture(t); writeFileSync(join(f.rn, "React/Fabric/RCTSurfaceTouchHandler.mm"), "changed native source");
  assert.throws(() => installNativeCancellation(f), /source contract moved/);
  assert.equal(f.calls.length, 0); assert.equal(existsSync(join(f.ios, "NativeDiagnostics")), false);
});

test("declared target getter or Pressable representation drift cannot install an observer", (t) => {
  for (const path of ["React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.h", "Libraries/Components/Pressable/Pressable.js"]) {
    const f = fixture(t); writeFileSync(join(f.rn, path), "changed target representation");
    assert.throws(() => installNativeCancellation(f), /source contract moved/);
    assert.equal(f.calls.length, 0); assert.equal(existsSync(join(f.ios, "NativeDiagnostics")), false);
  }
});
test("failed forwarding control cannot install a native observer", (t) => {
  const f = fixture(t);
  const run = (exe, args, options) => exe.endsWith("forwarding-control") ? "failed control" : f.run(exe, args, options);
  assert.throws(() => installNativeCancellation({ ...f, run }), /forwarding-control:pass/);
  assert.equal(existsSync(join(f.ios, "NativeDiagnostics")), false); assert(!f.calls.some((c) => c.exe === "ruby"));
});
