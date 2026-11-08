"""Hash-pinned, qualification-only observation of the original compact walk."""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile

REF = "14a408335e17a090df1e26bdbeaf80d8122a8fd8"
CLI = "edf1a9ec465f1fbe7a325d2f166e1135f19deeb671f9dd76aeedf8e6f887845c"
COMPILER = "1adb6f1a5845ba0aa5a59e412e44c8e405236b957de1a9683619f1dca3b16932"
SOURCES = {
    "InspectScreenTool": "18e1242aa1bd8c3c798f5fa7f21b394c6d35195931232d46cb56544aae8a86be",
    "ViewHierarchyFormatters": "f0d01230daa77932ba4527a4ba437dadc6fde04c87ea0f5b393c57e3c7dcb5d0",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def regular(path, limit):
    assert path.is_file() and not path.is_symlink() and path.stat().st_size <= limit
    return path.read_bytes()


def fetch(url, limit):
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(limit + 1)
    assert len(data) <= limit
    return data


def transform(data, patch, expected):
    assert sha(data) == expected == patch["originalSHA256"] and patch["inverseExact"] is True
    text = data.decode("utf8")
    assert 1 <= len(patch["edits"]) <= 24
    cursor, shift, inverse = 0, 0, []
    for edit in patch["edits"]:
        a, b, old, new = (edit[k] for k in ["start", "end", "old", "new"])
        assert type(a) is int and type(b) is int and cursor <= a <= b <= len(text)
        assert text[a:b] == old and isinstance(new, str)
        inverse.append((a + shift, a + shift + len(new), old))
        shift += len(new) - len(old)
        cursor = b
    result = text
    for edit in reversed(patch["edits"]):
        result = result[:edit["start"]] + edit["new"] + result[edit["end"]:]
    assert sha(result.encode()) == patch["patchedSHA256"]
    restored = result
    for a, b, old in reversed(inverse):
        restored = restored[:a] + old + restored[b:]
    assert restored.encode() == data
    return result.encode()


def family(name):
    return bool(re.match(r"^maestro/cli/mcp/tools/(?:InspectScreenTool|ViewHierarchyFormatters|QualificationCompact)(?:\$|\.class)", name))


def prepare(args):
    here = Path(__file__).parent.resolve()
    root = Path(args.output).absolute()
    root.mkdir(mode=0o700)
    private = root / ".private"
    private.mkdir(mode=0o700)
    proof = {"v": 1, "kind": "qualification-original-inspect-compact", "status": "building",
             "source": args.source_sha, "run": os.environ.get("GITHUB_RUN_ID"), "attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
             "upstream": REF, "loadedImage": "unattested", "timingPerturbed": True, "nativeAcceptance": False}

    def save():
        (root / "proof.json").write_text(json.dumps(proof, indent=2) + "\n")
        if args.public_proof:
            public = Path(args.public_proof).absolute()
            assert root.name == ".compact-build" and public == root.parent / "compact-build.json"
            public.write_text(json.dumps(proof, indent=2) + "\n")

    def command(name, argv, env=None, limit=90):
        proof["lastCommand"] = name
        save()
        try:
            result = subprocess.run([str(x) for x in argv], env=env, capture_output=True, timeout=limit)
        except subprocess.TimeoutExpired:
            proof["commandOutcome"] = "timeout"
            save()
            raise
        for ext, data in [("out", result.stdout), ("err", result.stderr), ("exit", str(result.returncode).encode())]:
            with (private / (name + "." + ext)).open("xb") as file:
                file.write(data)
        proof["commandOutcome"] = "returned"
        proof["commandExit"] = result.returncode
        save()
        return result

    save()
    try:
        assert not args.launcher_control or os.environ.get("GITHUB_ACTIONS") != "true", "CPU-only launcher control is not a hosted route"
        assert re.fullmatch(r"[a-f0-9]{40}", args.source_sha)
        executable = shutil.which("maestro")
        cli = Path(args.cli_root).resolve() if args.cli_root else Path(executable).resolve().parent.parent
        assert executable or args.cli_root
        if args.cli_root:
            assert cli.is_relative_to(root.parent) and cli != root.parent, "Owned disposable CLI copy required"
        else:
            owned = [here.parents[2] / "reports/.settle-cli"]
            if os.environ.get("RUNNER_TEMP"):
                owned.append(Path(os.environ["RUNNER_TEMP"]).resolve())
            assert any(cli.is_relative_to(path) for path in owned), "Owned hosted CLI copy required"
        java_home = Path(args.java_home or os.environ["JAVA_HOME"]).resolve()
        java, javap = java_home / "bin/java", java_home / "bin/javap"
        version = command("java-version", [java, "-version"])
        assert version.returncode == 0 and re.search(rb'version "17\.', version.stderr)
        lib = cli / "lib"
        original_jar = regular(lib / "maestro-cli-2.10.0.jar", 180 * 1024**2)
        assert sha(original_jar) == CLI
        compiler = Path(args.compiler) if args.compiler else private / "compiler.zip"
        if not args.compiler:
            compiler.write_bytes(fetch("https://github.com/JetBrains/kotlin/releases/download/v2.2.0/kotlin-compiler-2.2.0.zip", 128 * 1024**2))
        assert sha(regular(compiler, 128 * 1024**2)) == COMPILER
        spec = importlib.util.spec_from_file_location("compact_zip_limits", here.parent / "settle/stage.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.extract(compiler, private / "compiler", 512 * 1024**2)
        code, classes, fixtures = (private / n for n in ["code", "classes", "fixtures"])
        for path in [code, classes, fixtures]:
            path.mkdir()
        patches = json.loads(regular(here / "source.patch.json", 32768))
        for name, expected in SOURCES.items():
            original = regular(Path(args.upstream) / (name + ".kt.txt"), 32768) if args.upstream else fetch(
                f"https://raw.githubusercontent.com/mobile-dev-inc/Maestro/{REF}/maestro-cli/src/main/java/maestro/cli/mcp/tools/{name}.kt", 32768)
            (private / (name + ".original.kt")).write_bytes(original)
            (code / (name + ".kt")).write_bytes(transform(original, patches[name], expected))
        for source, target in [("Compact.kt.inc", "QualificationCompact.kt"), ("Controls.kt.inc", "BoundaryControls.kt")]:
            (code / target).write_bytes(regular(here / source, 32768))
        cp = os.pathsep.join(str(p) for p in sorted(lib.glob("*.jar")))
        files = [p for p in cli.rglob("*") if p.is_file()]
        assert len(files) <= 1024 and sum(p.stat().st_size for p in files) <= 1024**3
        before = {p.relative_to(cli).as_posix(): sha(regular(p, 180 * 1024**2)) for p in files}
        result = command("compile", [java, "-cp", private / "compiler/kotlinc/lib/*", "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
                         "-no-stdlib", "-no-reflect", "-classpath", cp, "-Xjdk-release=17", "-Xfriend-paths=" + str(lib / "maestro-cli-2.10.0.jar"),
                         "-module-name", "maestro-cli", "-d", classes, *sorted(code.glob("*.kt"))])
        assert result.returncode == 0
        for path in classes.rglob("*.class"):
            relative = path.relative_to(classes)
            if relative.name.startswith(("CompactBoundaryControls", "OriginalMarker", "QualificationCompact")):
                target = fixtures / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(path.read_bytes())
        main = "maestro.cli.mcp.tools.CompactBoundaryControls"
        controls = {}
        for name, first, options in [("baseline", fixtures, []), ("missing-red", fixtures, ["-DexpectObservation=true"]), ("observed", classes, ["-Dobserved=true"])]:
            result = command(name, [java, "-Djava.awt.headless=true", *options, "-cp", str(first) + os.pathsep + cp, main], limit=60)
            controls[name] = result
            if name == "missing-red":
                assert result.returncode != 0 and b"MISSING_ORIGINAL_COMPACT_BOUNDARY" in result.stderr
            else:
                assert result.returncode == 0
        cases = lambda result: [line for line in result.stdout.splitlines() if line.startswith((b"CASE ", b"OTHER_FORMAT ", b"FORMATTER_THROW_BOUNDS_READS "))]
        assert cases(controls["baseline"]) == cases(controls["observed"])
        original_descriptors = 0
        additions = 0
        for name in ["InspectScreenTool", "ViewHierarchyFormatters"]:
            classname = "maestro.cli.mcp.tools." + name
            original = command(name + "-original-abi", [javap, "-public", "-s", "-classpath", lib / "maestro-cli-2.10.0.jar", classname])
            candidate = command(name + "-observed-abi", [javap, "-public", "-s", "-classpath", classes, classname])
            pattern = rb"  public[^\n]*\n    descriptor: [^\n]*"
            old, new = (set(re.findall(pattern, p.stdout)) for p in [original, candidate])
            assert original.returncode == candidate.returncode == 0 and old <= new
            original_descriptors += len(old)
            additions += len(new - old)
        bytecodes = {}
        for name, first in [("original", lib / "maestro-cli-2.10.0.jar"), ("observed", classes)]:
            result = command(name + "-getter-bytecode", [javap, "-p", "-c", "-classpath", first, "maestro.cli.mcp.tools.ViewHierarchyFormatters"])
            assert result.returncode == 0
            bytecodes[name] = result.stdout.decode()
        getter_proof = {}
        for method in ["compactTreeData", "hasZeroSize", "hasNonDefaultValues", "convertToCompactNode"]:
            counts = []
            for name in ["original", "observed"]:
                chunks = [c for c in re.split(r"(?m)^  (?=[^ ])", bytecodes[name]) if re.search(r"\b" + method + r"\(", c.splitlines()[0])]
                assert chunks
                body = max(chunks, key=len)
                counts.append(Counter(re.findall(r"maestro/TreeNode\.(get[A-Za-z]+):", body)))
            assert counts[0] == counts[1]
            getter_proof[method] = dict(counts[0])
        compiled = {p.relative_to(classes).as_posix(): p.read_bytes() for p in classes.rglob("*.class") if family(p.relative_to(classes).as_posix())}
        assert all(b"maestro/TreeNode" not in data for name, data in compiled.items() if name.startswith("maestro/cli/mcp/tools/QualificationCompact"))
        candidate_jar = private / "observed-cli.jar"
        with zipfile.ZipFile(lib / "maestro-cli-2.10.0.jar") as original, zipfile.ZipFile(candidate_jar, "x", zipfile.ZIP_DEFLATED) as candidate:
            missing = {n for n in original.namelist() if family(n)} - compiled.keys()
            checked = list(compiled.values()) + [original.read(n) for n in original.namelist() if n.endswith(".class") and not family(n)]
            for name in missing:
                token = name.removesuffix(".class")
                assert all(token.encode() not in data and token.replace("/", ".").encode() not in data for data in checked)
                compiled[name] = original.read(name)
            for entry in original.infolist():
                if not family(entry.filename):
                    candidate.writestr(entry, original.read(entry.filename))
            for name, data in compiled.items():
                candidate.writestr(name, data)
        with zipfile.ZipFile(lib / "maestro-cli-2.10.0.jar") as original, zipfile.ZipFile(candidate_jar) as candidate:
            unrelated = [n for n in original.namelist() if not family(n)]
            assert all(original.read(n) == candidate.read(n) for n in unrelated)
        result = command("packaged-observed", [java, "-Djava.awt.headless=true", "-Dobserved=true", "-cp",
                         str(candidate_jar) + os.pathsep + str(fixtures) + os.pathsep + cp, main], limit=60)
        assert result.returncode == 0 and cases(result) == cases(controls["baseline"])
        proof.update({"sourceInverseExact": True, "originalCliSHA256": CLI, "cliSHA256": sha(candidate_jar.read_bytes()),
                      "originalPublicDescriptorsPreserved": original_descriptors, "additionalPublicBridgesAndOverload": additions,
                      "unrelatedEntriesByteIdentical": len(unrelated), "originalPrivateClassesRetainedUnreferenced": len(missing),
                      "helperHasNoTreeNodeReference": True,
                      "originalAndObservedOracleCases": sum(line.startswith(b"CASE ") for line in cases(result)),
                      "otherFormatterOracleCalls": sum(line.startswith(b"OTHER_FORMAT ") for line in cases(result)),
                      "originalGetterSitesPreserved": getter_proof,
                      "limits": {"invocations": 36, "nodes": 512, "depth": 24, "facts": 8, "rowsPerInvocation": 12, "rowBytes": 1024, "processBytes": 131072}})
        (private / "original-cli.jar").write_bytes(original_jar)
        # The runner calls this after the existing phone5 original-CLI build guard.
        # Only a fresh job-local CLI copy is adopted; no app or upstream file changes.
        assert sha(regular(lib / "maestro-cli-2.10.0.jar", 180 * 1024**2)) == CLI
        shutil.copyfile(candidate_jar, lib / "maestro-cli-2.10.0.jar")
        after = {p.relative_to(cli).as_posix(): sha(regular(p, 180 * 1024**2)) for p in cli.rglob("*") if p.is_file()}
        assert before.keys() == after.keys()
        assert [n for n in before if before[n] != after[n]] == ["lib/maestro-cli-2.10.0.jar"]
        proof["otherCliFilesByteIdentical"] = len(before) - 1
        proof["actualLauncherMetadataControl"] = "not-run-use-original-owned-reset-request"
        if args.launcher_control:
            runtime_env = {**os.environ, "JAVA_HOME": str(java_home), "PATH": str(cli / "bin") + os.pathsep + os.environ.get("PATH", ""),
                           "MAESTRO_CLI_NO_ANALYTICS": "true", "MAESTRO_DISABLE_UPDATE_CHECK": "true", "MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED": "true"}
            result = command("actual-launcher-metadata", ["node", here / "runtimeControl.mjs", args.source_sha], env=runtime_env, limit=60)
            assert result.returncode == 0 and b"ACTUAL_COMPACT_LAUNCHER_CONTROL_PASS" in result.stdout
            assert sha(regular(lib / "maestro-cli-2.10.0.jar", 180 * 1024**2)) == proof["cliSHA256"]
            proof["actualLauncherMetadataControl"] = "CPU-only-missing-device-original-result-query-not-entered"
        proof["status"] = "prepared"
        save()
        return proof
    except BaseException:
        proof["status"] = "failed"
        save()
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--public-proof")
    parser.add_argument("--launcher-control", action="store_true")
    for name in ["cli-root", "java-home", "compiler", "upstream"]:
        parser.add_argument("--" + name)
    try:
        prepare(parser.parse_args())
    except BaseException:
        print("Original compact observation preparation failed; finite proof retained.")
        sys.exit(1)
    print("Prepared source-patched qualification-only original compact observation; no native acceptance claim.")
