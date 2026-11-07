import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PINNED_RN = Object.freeze({
  "React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm": "e22e80cf435cd3ecb40f117843c91a0dbe11a5937cc38c90e55bd5e406f2b487",
  "React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.h": "c7569da192af451354236ca1899d0af4fe40eb76b2af46901bb79f85e2b5c3e4",
  "React/Fabric/Mounting/ComponentViews/ScrollView/RCTEnhancedScrollView.h": "4ffa903021b602929085285c196f9d313115074ee1aa6f0c55e1f0092468e770",
  "React/Fabric/Utils/RCTGenericDelegateSplitter.mm": "2e47a53945c852d25946c4de7832faa78dec44c37b86d83778e959b98b2ee7d8",
  "React/Fabric/Utils/RCTGenericDelegateSplitter.h": "85803ad87fa83cba2b4d6a9943e7c0e85b24ece65d03cef9ebc169d7f3a51f8b",
  "React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm": "cbdbe8224168362cd14c2065691cb2548b873c5e51988f64ade50fa0173e51fa",

  "React/Fabric/RCTSurfaceTouchHandler.mm": "7326c79d3cbd91762a18e0d6e21744bd7520521ded318a8f8411391e336e5dd3",
  "React/Fabric/Mounting/ComponentViews/ScrollView/RCTEnhancedScrollView.mm": "278a25071d38dd7d691adebf536f71960636d15622e9d332ca7f2436f711481c",
  "React/CoreModules/RCTAlertController.mm": "f9277ab7a24dae313dbebb05e10ef875a8699645fa2868847281b191d599fdbc",
  "React/CoreModules/RCTAlertManager.mm": "7cffd9837ecb1c03a67a66661160d8786ccb90574911c3325d6cf09c1cbf2aff",
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
  for (const [name, filename, signal] of [["forwarding-control", "ForwardingControl.mm", "native-cancel-forwarding-control:pass"],
    ["modal-control", "ModalForwardingControl.mm", "native-modal-forwarding-control:pass"],
    ["scroll-control", "ScrollForwardingControl.mm", "native-scroll-forwarding-control:pass"]]) {
    const control = join(privateOutput, name);
    run("xcrun", ["--sdk", "macosx", "clang++", "-fobjc-arc", "-framework", "Foundation", "-o", control, join(source, filename)], { log: `${name}-build.log`, timeout: 60000 });
    assert.equal(run(control, [], { capture: true, log: `${name}.log`, timeout: 10000 }), signal);
  }
  mkdirSync(generated);
  for (const name of ["NativeCancelObserver.mm", "RuntimeHooks.h", "NativeModalObserver.mm", "ModalWindowRuntime.h", "NativeScrollObserver.mm", "NativeScrollObserver.h", "ScrollReceiverRuntime.h"]) copyFileSync(join(source, name), join(generated, name));
  const injected = JSON.parse(run("ruby", [join(source, "inject.rb"), join(ios, projects[0]), join(generated, "NativeCancelObserver.mm")], { capture: true, log: "native-cancel-injection.log" }));
  assert.deepEqual(injected, { added: true, sourceCount: 3 });
  return { schemaVersion: 1, scope: "generated-qualification-simulator-only", reactNativeVersion: "0.86.3", rnSources,
    sourceFiles: ["NativeCancelObserver.mm", "RuntimeHooks.h", "ForwardingControl.mm", "inject.rb", "NativeModalObserver.mm", "ModalWindowRuntime.h", "ModalForwardingControl.mm", "NativeScrollObserver.mm", "NativeScrollObserver.h", "ScrollReceiverRuntime.h", "ScrollForwardingControl.mm"].map((path) => ({ path, sha256: hash(readFileSync(join(source, path))) })),
    forwardingControl: "passed", modalForwardingControl: "passed", scrollForwardingControl: "passed", generatedSourceCount: 3, runtimeInstallation: "pending-observation", loadedRNImage: "unattested",
    modalScope: "owned-reset-alert-only", scrollScope: "verified-help-receiver-scroll-pair-only", directModalCallback: "unavailable-cxx-reference-abi" };
}
