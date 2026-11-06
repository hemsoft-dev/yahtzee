import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PINNED_RN = Object.freeze({
  "React/Fabric/RCTSurfaceTouchHandler.mm": "7326c79d3cbd91762a18e0d6e21744bd7520521ded318a8f8411391e336e5dd3",
  "React/Fabric/Mounting/ComponentViews/ScrollView/RCTEnhancedScrollView.mm": "278a25071d38dd7d691adebf536f71960636d15622e9d332ca7f2436f711481c",
});
const hash = (b) => createHash("sha256").update(b).digest("hex");

/** Generated simulator target only. No RN dependency, archive project or source file is rewritten. */
export function installNativeCancellation({ root, ios, output, run }) {
  assert.equal(ios, join(root, "apps/mobile/ios"), "Only the generated simulator project is eligible.");
  const rn = join(root, "apps/mobile/node_modules/react-native");
  assert.equal(JSON.parse(readFileSync(join(rn, "package.json"))).version, "0.86.3");
  const rnSources = Object.entries(PINNED_RN).map(([path, expected]) => {
    const sha256 = hash(readFileSync(join(rn, path), "utf8").replace(/\r\n/g, "\n"));
    assert.equal(sha256, expected, "Native cancellation source contract moved; review before observation.");
    return { path, sha256 };
  });
  const projects = readdirSync(ios).filter((n) => n.endsWith(".xcodeproj")); assert.equal(projects.length, 1);
  const pbx = join(ios, projects[0], "project.pbxproj"); assert(lstatSync(pbx).isFile() && !lstatSync(pbx).isSymbolicLink());
  const source = join(root, "scripts/ios-native/native-cancel"), generated = join(ios, "NativeDiagnostics");
  assert(!existsSync(generated), "Existing generated native observations were preserved.");
  const privateOutput = join(output, ".native-cancel"); assert(!existsSync(privateOutput)); mkdirSync(privateOutput);
  const control = join(privateOutput, "forwarding-control");
  run("xcrun", ["--sdk", "macosx", "clang++", "-fobjc-arc", "-framework", "Foundation", "-o", control, join(source, "ForwardingControl.mm")], { log: "native-cancel-control-build.log", timeout: 60000 });
  assert.equal(run(control, [], { capture: true, log: "native-cancel-control.log", timeout: 10000 }), "native-cancel-forwarding-control:pass");
  mkdirSync(generated);
  for (const name of ["NativeCancelObserver.mm", "RuntimeHooks.h"]) copyFileSync(join(source, name), join(generated, name));
  const injected = JSON.parse(run("ruby", [join(source, "inject.rb"), join(ios, projects[0]), join(generated, "NativeCancelObserver.mm")], { capture: true, log: "native-cancel-injection.log" }));
  assert.deepEqual(injected, { added: true, sourceCount: 1 });
  return { schemaVersion: 1, scope: "generated-qualification-simulator-only", reactNativeVersion: "0.86.3", rnSources,
    sourceFiles: ["NativeCancelObserver.mm", "RuntimeHooks.h", "ForwardingControl.mm", "inject.rb"].map((path) => ({ path, sha256: hash(readFileSync(join(source, path))) })),
    forwardingControl: "passed", generatedSourceCount: 1, runtimeInstallation: "pending-observation", loadedRNImage: "unattested" };
}
