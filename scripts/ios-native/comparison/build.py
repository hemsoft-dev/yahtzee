"""Qualification-only, exact-source ImageComparison rectangle aggregation patch."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import urllib.request
import zipfile

JAR_SHA = "b3331881bafd1d539e728e4670301931d019a23a2eabf257370a06075cb16c83"
SOURCE_ARCHIVE_SHA = "3dbe0ab7eb098cf42a75c87cab2b451343197531738d2b50335c674914712d54"
SOURCE_SHA = "d844a6c6e9a7d1704718dae2ecc87546a24fec1009bc61ebb1ca464178451124"
CLIENT_SHA = "acc437d88e4843f2e786c332ecbcd0a09267f9f47a155cc0460a0e98dc928104"
CLI_SHA = "edf1a9ec465f1fbe7a325d2f166e1135f19deeb671f9dd76aeedf8e6f887845c"
NATIVE_SHA = "1a4e4582e7b415167782711c04b914df878899d04757a2de82c3bf7a5b4c99f1"
LAUNCHER_SHA = "78c82065869bbabf4659e52284defd346de897d58675c6ba1dc7c70c12aed07f"
SOURCE_URL = "https://repo.maven.apache.org/maven2/com/github/romankh3/image-comparison/4.4.0/image-comparison-4.4.0-sources.jar"
CLASS = "com/github/romankh3/image/comparison/ImageComparison.class"
SOURCE = CLASS.removesuffix(".class") + ".java"
OLD = """        while (counter <= regionCount) {
            Rectangle rectangle = createRectangle();"""
NEW = """        Rectangle[] regionRectangles = new Rectangle[Math.max(0, regionCount - counter + 1)];
        for (int i = 0; i < regionRectangles.length; i++) {
            regionRectangles[i] = Rectangle.createDefault();
        }
        for (int y = 0; y < matrix.length; y++) {
            for (int x = 0; x < matrix[0].length; x++) {
                int index = matrix[y][x] - counter;
                if (index >= 0 && index < regionRectangles.length) {
                    updateRectangleCreation(regionRectangles[index], x, y);
                }
            }
        }
        int regionIndex = 0;
        while (counter <= regionCount) {
            Rectangle rectangle = regionRectangles[regionIndex++];"""
CAPTURE_POINT = "        long countOfDifferentPixels = populateTheMatrixOfTheDifferences();"
CAPTURE_CALL = CAPTURE_POINT + """
        if ("1".equals(System.getenv("THIRDROLL_COMPARISON_CAPTURE"))) {
            try {
                maestro.QualificationComparisonCapture.snapshot(matrix, countOfDifferentPixels,
                        counter, regionCount, threshold, minimalRectangleSize, allowingPercentOfDifferentPixels);
            } catch (Throwable unavailable) { /* Observation cannot replace the original operation. */ }
        }"""


def sha(data):
    return hashlib.sha256(data).hexdigest()


def numeric_identity(value):
    return value if isinstance(value, str) and re.fullmatch(r"[0-9]{1,20}", value) else None


def source_identity(payload, fallback):
    if not isinstance(payload, dict):
        return None
    if "pull_request" in payload:
        pull = payload["pull_request"]
        head = pull.get("head") if isinstance(pull, dict) else None
        value = head.get("sha") if isinstance(head, dict) else None
    else:
        value = fallback
    return value if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) else None


def regular(path, limit):
    info = path.lstat()
    assert stat.S_ISREG(info.st_mode) and info.st_size <= limit, "bounded regular file required"
    return path.read_bytes()


def transform(source, capture=False):
    assert sha(source) == SOURCE_SHA, "pinned comparison source required"
    text = source.decode("utf8")
    assert text.count(OLD) == 1
    patched = text.replace(OLD, NEW)
    if capture:
        assert patched.count(CAPTURE_POINT) == 1
        patched = patched.replace(CAPTURE_POINT, CAPTURE_CALL)
    assert patched.replace(CAPTURE_CALL, CAPTURE_POINT).replace(NEW, OLD) == text
    return patched.encode("utf8")


def rewrite(original, output, classes):
    compiled = sorted(p.relative_to(classes).as_posix() for p in classes.rglob("*.class"))
    assert compiled == [CLASS], "only the comparator class may be compiled"
    with zipfile.ZipFile(original) as source, zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED) as target:
        names = source.namelist()
        assert len(names) == len(set(names)) and names.count(CLASS) == 1
        for info in source.infolist():
            target.writestr(info, (classes / CLASS).read_bytes() if info.filename == CLASS else source.read(info))
    with zipfile.ZipFile(original) as source, zipfile.ZipFile(output) as target:
        assert source.namelist() == target.namelist()
        assert all(source.read(n) == target.read(n) for n in source.namelist() if n != CLASS)
    return {"changedEntries": [CLASS], "unchangedEntries": len(names) - 1, "sha256": sha(output.read_bytes())}


def methods(disassembly):
    # javap's pool indices depend on compilation order. The resolved comments,
    # instructions, arguments and exception tables remain compared.
    text = re.sub(r"#\d+", "#", disassembly)
    chunks = re.split(r"(?m)^  (?=[^ ])", text)
    return {c.splitlines()[0]: c for c in chunks[1:] if c.strip() != "}"}


def build(args):
    cli = Path(args.cli_root).resolve()
    output = Path(args.output).absolute()
    assert not output.exists() and output.parent.is_dir(), "fresh owned build directory required"
    java_home = Path(args.java_home).resolve()
    suffix = ".exe" if os.name == "nt" else ""
    java, javac, javap = [java_home / "bin" / (n + suffix) for n in ["java", "javac", "javap"]]
    target = cli / "lib/image-comparison-4.4.0.jar"
    output.mkdir(mode=0o700)
    private = output / ".private"
    private.mkdir(mode=0o700)
    receipt = {"schemaVersion": 1, "kind": "qualification-source-patched-comparator", "status": "building",
               "version": "4.4.0", "originalJarSha256": JAR_SHA, "sourceSha256": SOURCE_SHA,
               "sourceArchiveSha256": SOURCE_ARCHIVE_SHA,
               "scope": "one-pass-region-rectangle-aggregation", "source": None,
               "runId": numeric_identity(os.environ.get("GITHUB_RUN_ID")),
               "attempt": numeric_identity(os.environ.get("GITHUB_RUN_ATTEMPT")),
               "deadlinesChanged": False, "loadedImage": "unattested", "performanceGate": False}
    event = os.environ.get("GITHUB_EVENT_PATH")
    if event:
        try:
            payload = json.loads(regular(Path(event), 4 * 1024**2))
            receipt["source"] = source_identity(payload, os.environ.get("GITHUB_SHA"))
        except (OSError, ValueError, AssertionError):
            pass  # Unavailable identity is null, never a payload or a guessed PR head.
    def save():
        (output / "proof.json").write_text(json.dumps(receipt, indent=2) + "\n")
    def command(name, argv, env=None, expected=0):
        r = subprocess.run(list(map(str, argv)), capture_output=True, timeout=90, env=env)
        for extension, data in [("out", r.stdout), ("err", r.stderr), ("exit", str(r.returncode).encode())]:
            with (private / (name + "." + extension)).open("xb") as stream:
                stream.write(data)
        assert r.returncode == expected, "comparison build/control failed"
        return r.stdout
    save()
    try:
        if os.environ.get("GITHUB_ACTIONS") == "true":
            assert all(receipt[k] is not None for k in ["source", "runId", "attempt"]), "hosted identity unavailable"
        original = regular(target, 1024**2)
        assert sha(original) == JAR_SHA, "pinned original comparator JAR required"
        client_sha = CLIENT_SHA
        if args.observed_client_proof:
            observed = json.loads(regular(Path(args.observed_client_proof), 65536))
            assert observed["status"] == "prepared" and observed["controls"]["publicABIExact"] is True
            assert observed["upstreamSource"] == "14a408335e17a090df1e26bdbeaf80d8122a8fd8"
            assert observed["archiveSha256"] == "29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991"
            client_sha = observed["client"]["sha256"]
            assert isinstance(client_sha, str) and re.fullmatch(r"[0-9a-f]{64}", client_sha)
        if args.capture_inputs:
            assert args.observed_client_proof and observed["controls"]["comparisonCapture"] is True
            assert re.fullmatch(r"[0-9a-f]{64}", observed["comparisonCaptureSourceSha256"])
            receipt["captureSourceSha256"] = observed["comparisonCaptureSourceSha256"]
        for path, expected, limit in [("lib/maestro-client.jar", client_sha, 32 * 1024**2),
                                      ("lib/maestro-cli-2.10.0.jar", CLI_SHA, 128 * 1024**2),
                                      ("lib/maestro-ios-driver.jar", NATIVE_SHA, 180 * 1024**2),
                                      ("bin/maestro", LAUNCHER_SHA, 65536)]:
            assert sha(regular(cli / path, limit)) == expected, "original or observed CLI identity mismatch"
        command("java-version", [java, "-version"])
        # Java writes its identity to stderr; pin major without exporting raw output.
        assert re.search(rb'version "17\.', (private / "java-version.err").read_bytes())
        compiler = command("compiler-version", [javac, "-version"])
        assert re.match(rb"javac 17\.", compiler)
        if args.source_archive:
            archive = regular(Path(args.source_archive), 200000)
        else:
            with urllib.request.urlopen(SOURCE_URL, timeout=30) as response:
                archive = response.read(200001)
        assert len(archive) <= 200000 and sha(archive) == SOURCE_ARCHIVE_SHA
        (private / "sources.jar").write_bytes(archive)
        with zipfile.ZipFile(private / "sources.jar") as z:
            assert z.namelist().count(SOURCE) == 1
            source = z.read(SOURCE)
        patched = transform(source, args.capture_inputs)
        receipt["patchedSourceSha256"] = sha(patched)
        original_jar = private / "original.jar"
        original_jar.write_bytes(original)
        dirs = {}
        for name, code in [("original", source), ("candidate", patched)]:
            d = private / name
            d.mkdir()
            (d / "ImageComparison.java").write_bytes(code)
            command("compile-" + name, [javac, "--release", "8", "-g", "-cp", str(original_jar) + os.pathsep + str(cli / "lib/maestro-client.jar"), "-d", d, d / "ImageComparison.java"])
            dirs[name] = d
        candidate_jar = private / "candidate.jar"
        receipt["jar"] = rewrite(original_jar, candidate_jar, dirs["candidate"])
        cls = CLASS.removesuffix(".class").replace("/", ".")
        original_abi = command("original-abi", [javap, "-classpath", original_jar, "-public", "-s", cls])
        patched_abi = command("candidate-abi", [javap, "-classpath", candidate_jar, "-public", "-s", cls])
        assert original_abi == patched_abi, "public ABI drift"
        dis = {}
        for name, cp in [("rebuilt", dirs["original"]), ("candidate", dirs["candidate"])]:
            dis[name] = methods(command("bytecode-" + name, [javap, "-classpath", str(cp) + os.pathsep + str(original_jar), "-c", "-p", cls]).decode())
        assert dis["rebuilt"].keys() == dis["candidate"].keys()
        changed = [k for k in dis["rebuilt"] if dis["rebuilt"][k] != dis["candidate"][k]]
        assert changed == ["private java.util.List<com.github.romankh3.image.comparison.model.Rectangle> populateRectangles();"], "unrelated method bytecode drift"
        fixtures = private / "fixtures"
        fixtures.mkdir()
        for name in ["Equivalent", "Extra"]:
            (fixtures / (name + ".java")).write_bytes(regular(Path(__file__).parent / (name + ".java.inc"), 32 * 1024))
        command("compile-controls", [javac, "--release", "17", "-d", fixtures, fixtures / "Equivalent.java", fixtures / "Extra.java"])
        for name in ["Equivalent", "Extra"]:
            # Private oracle controls retain helpful exception details. This flag
            # is never passed to the installed CLI or its original requests.
            log = command("control-" + name, [java, "-Xmx1g", "-XX:-OmitStackTraceInFastThrow", "-Djava.awt.headless=true",
                          "-Dstudy.dir=" + str(fixtures), "-cp", fixtures, name,
                          original_jar, dirs["original"], dirs["candidate"], "controls-only"])
            assert (b"EQUIVALENCE_PASS cases=569" if name == "Equivalent" else b"EXTRA_PASS cases=69") in log
        # Verify the packaged bytes, not only loose candidate classes.
        packaged = command("control-packaged", [java, "-Xmx1g", "-XX:-OmitStackTraceInFastThrow", "-Djava.awt.headless=true",
                            "-cp", fixtures, "Equivalent", original_jar, dirs["original"], candidate_jar, "controls-only"])
        assert b"EQUIVALENCE_PASS cases=569" in packaged
        if args.capture_inputs:
            capture_source = fixtures / "CaptureForwarding.java"
            capture_source.write_bytes(regular(Path(__file__).parent / "CaptureForwarding.java.inc", 16384))
            libraries = os.pathsep.join(str(p) for p in sorted((cli / "lib").glob("*.jar")))
            command("compile-capture-forwarding", [javac, "--release", "17", "-cp", str(candidate_jar) + os.pathsep + libraries,
                    "-d", fixtures, capture_source])
            capture_root = private / ".comparison-input"
            capture_root.mkdir(mode=0o700)
            env = {**os.environ, "THIRDROLL_COMPARISON_CAPTURE": "1", "THIRDROLL_CAPTURE_SOURCE": "a" * 40,
                   "GITHUB_RUN_ID": "1", "GITHUB_RUN_ATTEMPT": "1", "THIRDROLL_CAPTURE_ROUTE": "1",
                   "THIRDROLL_CAPTURE_DIRECTORY": str(capture_root)}
            command("original-capture-red", [java, "-Djava.awt.headless=true", "-cp", str(fixtures) + os.pathsep + libraries,
                    "CaptureForwarding", capture_root], env=env, expected=1)
            assert b"ORIGINAL_MASK_RETURNED" in (private / "original-capture-red.out").read_bytes()
            assert b"MISSING_COMPARISON_CAPTURE" in (private / "original-capture-red.err").read_bytes()
            capture_control = command("capture-forwarding", [java, "-Djava.awt.headless=true", "-cp",
                    str(fixtures) + os.pathsep + str(candidate_jar) + os.pathsep + libraries, "CaptureForwarding", capture_root], env=env)
            assert b"CAPTURE_FORWARDING_PASS" in capture_control
            receipt["captureControls"] = {"originalMissingCaptureRed": True, "originalGetterOrder": True,
                                          "resultErrorIdentity": True, "immutableMatrix": True}
        # All original CLI files except this one library remain byte-identical.
        before = {p.relative_to(cli).as_posix(): sha(p.read_bytes()) for p in cli.rglob("*") if p.is_file()}
        receipt["cliJarSha256"] = before["lib/maestro-cli-2.10.0.jar"]
        receipt["nativeJarSha256"] = before["lib/maestro-ios-driver.jar"]
        receipt["clientJarSha256"] = before["lib/maestro-client.jar"]
        receipt["launcherSha256"] = before["bin/maestro"]
        assert sha(target.read_bytes()) == JAR_SHA
        shutil.copyfile(candidate_jar, target)
        after = {p.relative_to(cli).as_posix(): sha(p.read_bytes()) for p in cli.rglob("*") if p.is_file()}
        assert before.keys() == after.keys()
        assert [n for n in before if before[n] != after[n]] == ["lib/image-comparison-4.4.0.jar"]
        receipt.update({"status": "prepared", "publicABIExact": True, "changedMethods": changed,
                        "oracleCases": 638, "packagedOracleCases": 569, "otherCliFilesIdentical": len(before) - 1,
                        "originalRetained": True, "exceptionDetailControlOnly": True})
        save()
    except BaseException:
        receipt["status"] = "failed"
        receipt["failure"] = "input-build-equivalence-or-install-gate"
        save()
        raise
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ["cli-root", "java-home", "output"]:
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--source-archive")
    parser.add_argument("--observed-client-proof")
    parser.add_argument("--capture-inputs", action="store_true")
    try:
        build(parser.parse_args())
    except Exception:
        print("Comparator qualification build failed; finite proof and private controls retained.")
        sys.exit(1)
    print("Prepared source-patched comparison-only qualification CLI; original actions and budgets retained.")
