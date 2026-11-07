"""Build an isolated, pinned-source qualification copy. Never install globally."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import zipfile

SOURCE_REF = "14a408335e17a090df1e26bdbeaf80d8122a8fd8"
SOURCE_PATH = "maestro-client/src/main/java/maestro/Maestro.kt"
SOURCE_SHA = "910ccef099db614ee153c4f85716a15592c870f969fc4aa5b93dcf6872c17a94"
DRIVER_PATH = "maestro-client/src/main/java/maestro/drivers/IOSDriver.kt"
DRIVER_SHA = "bb93fd4eb42e07b6b7d4bf6921dfeebf4b89f218cd1792d16d94153cf1ef47e9"
IMAGE_PATH = "maestro-client/src/main/java/maestro/utils/ScreenshotUtils.kt"
IMAGE_SHA = "5f9381fa52134a6ed08c6e45db2c58e1fcfdf936a24d7a640cd300a653a1d22e"
ARCHIVE_SHA = "29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991"
COMPILER_SHA = "1adb6f1a5845ba0aa5a59e412e44c8e405236b957de1a9683619f1dca3b16932"
CLIENT_SHA = "acc437d88e4843f2e786c332ecbcd0a09267f9f47a155cc0460a0e98dc928104"
CLI_SHA = "edf1a9ec465f1fbe7a325d2f166e1135f19deeb671f9dd76aeedf8e6f887845c"
IOS_SHA = "1a4e4582e7b415167782711c04b914df878899d04757a2de82c3bf7a5b4c99f1"
REPLACEMENTS = [
    ("        driver.waitForAppToSettle(initialHierarchy, appId, waitToSettleTimeoutMs)",
     "        QualificationSettleObservation.observe(2) { driver.waitForAppToSettle(initialHierarchy, appId, waitToSettleTimeoutMs) }"),
    ("        ScreenshotUtils.waitUntilScreenIsStatic(timeout, SCREENSHOT_DIFF_THRESHOLD, driver)",
     "        QualificationSettleObservation.observe(1) { ScreenshotUtils.waitUntilScreenIsStatic(timeout, SCREENSHOT_DIFF_THRESHOLD, driver) }"),
]
DRIVER_REPLACEMENTS = [
    ('            runDeviceCall("takeScreenshot") { iosDevice.takeScreenshot(out, compressed) }',
     '            maestro.QualificationSettleObservation.device(3) { runDeviceCall("takeScreenshot") { iosDevice.takeScreenshot(out, compressed) } }'),
    ('        return runDeviceCall("isScreenStatic") { iosDevice.isScreenStatic() }',
     '        return maestro.QualificationSettleObservation.device(4) { runDeviceCall("isScreenStatic") { iosDevice.isScreenStatic() } }'),
]
IMAGE_REPLACEMENTS = [
    ('            ImageIO.read(takeScreenshot(true, driver).inputStream())',
     '            maestro.QualificationSettleObservation.readImage(takeScreenshot(true, driver).inputStream())'),
    ('                    val imageDiff = ImageComparison(\n                        startScreenshot,\n                        endScreenshot\n                    ).compareImages().differencePercent',
     '                    val imageDiff = maestro.QualificationSettleObservation.device(6) { ImageComparison(\n                        startScreenshot,\n                        endScreenshot\n                    ).compareImages().differencePercent }'),
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def regular(path, maximum):
    info = path.lstat()
    assert stat.S_ISREG(info.st_mode) and info.st_size <= maximum, "Regular bounded input required"
    return path.read_bytes()


def transform(data, expected=SOURCE_SHA, replacements=REPLACEMENTS):
    assert sha(data) == expected, "Pinned source hash mismatch"
    source = data.decode("utf8")
    value = source
    for old, new in replacements:
        assert value.count(old) == 1, "Pinned insertion point mismatch"
        value = value.replace(old, new)
    restored = value
    for old, new in replacements:
        restored = restored.replace(new, old)
    assert restored == source, "Only the pinned observation expressions may differ"
    return value.encode("utf8")


def extract(archive, destination, total_limit):
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        assert len(members) < 5000 and len({m.filename for m in members}) == len(members)
        assert sum(m.file_size for m in members) <= total_limit
        for item in members:
            raw_name = getattr(item, "orig_filename", None)
            assert isinstance(raw_name, str) and "\\" not in raw_name and ":" not in raw_name
            assert not any(ord(c) < 32 for c in raw_name)
            name = item.filename
            path = PurePosixPath(name)
            assert not path.is_absolute() and ".." not in path.parts
            assert "\\" not in name and ":" not in name and not any(ord(c) < 32 for c in name)
            assert not stat.S_ISLNK(item.external_attr >> 16) and item.file_size <= 180 * 1024**2
        for item in members:
            if item.is_dir():
                continue
            target = destination.joinpath(*PurePosixPath(item.filename).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as out:
                out.write(source.read(item))
            target.chmod(0o700 if item.external_attr >> 16 & 0o111 else 0o600)


def class_family(name):
    return bool(re.match(r"^maestro/(?:Maestro(?:\$|\.class)|drivers/IOSDriver(?:\$|\.class)|utils/ScreenshotUtils(?:\$|\.class)|QualificationSettleObservation(?:\$|\.class))", name))


def rewrite_client(original, output, classes):
    added = {p.relative_to(classes).as_posix(): p.read_bytes()
             for p in classes.rglob("*.class") if class_family(p.relative_to(classes).as_posix())}
    assert all(n in added for n in ["maestro/Maestro.class", "maestro/drivers/IOSDriver.class", "maestro/utils/ScreenshotUtils.class"])
    replaced = []
    with zipfile.ZipFile(original) as source, zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED) as target:
        family = {n for n in source.namelist() if class_family(n)}
        assert family.issubset(added), "Recompiled source must preserve every original class-family member"
        for info in source.infolist():
            if class_family(info.filename):
                replaced.append(info.filename)
            else:
                target.writestr(info, source.read(info))
        for name, data in added.items():
            target.writestr(name, data)
    with zipfile.ZipFile(original) as source, zipfile.ZipFile(output) as target:
        untouched = [n for n in source.namelist() if not class_family(n)]
        assert all(source.read(n) == target.read(n) for n in untouched)
    return {"recompiledOriginalEntries": len(replaced), "compiledEntries": len(added),
            "otherEntriesByteIdentical": len(untouched), "sha256": sha(output.read_bytes())}


def stage(args):
    source = Path(args.source).resolve()
    archive, compiler = Path(args.archive), Path(args.compiler)
    output = Path(args.output).absolute()
    java_home = Path(args.java_home).resolve()
    java = java_home / "bin" / ("java.exe" if os.name == "nt" else "java")
    javap = java_home / "bin" / ("javap.exe" if os.name == "nt" else "javap")
    assert not output.exists() and output.parent.is_dir(), "Fresh owned output required"
    original_source = regular(source / SOURCE_PATH, 128 * 1024)
    patched = transform(original_source)
    original_driver = regular(source / DRIVER_PATH, 128 * 1024)
    patched_driver = transform(original_driver, DRIVER_SHA, DRIVER_REPLACEMENTS)
    original_image = regular(source / IMAGE_PATH, 128 * 1024)
    patched_image = transform(original_image, IMAGE_SHA, IMAGE_REPLACEMENTS)
    assert sha(regular(archive, 400 * 1024**2)) == ARCHIVE_SHA
    assert sha(regular(compiler, 100 * 1024**2)) == COMPILER_SHA
    output.mkdir(mode=0o700)
    private = output / ".private"
    private.mkdir()
    env = {k: v for k, v in os.environ.items() if k in ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG"]}
    env["JAVA_HOME"] = str(java_home)
    receipt = {"schemaVersion": 1, "kind": "qualification-source-copy-settle-stages", "status": "building",
               "upstreamSource": SOURCE_REF, "sourceSha256": SOURCE_SHA, "patchedSourceSha256": sha(patched),
               "driverSourceSha256": DRIVER_SHA, "patchedDriverSourceSha256": sha(patched_driver),
               "imageSourceSha256": IMAGE_SHA, "patchedImageSourceSha256": sha(patched_image),
               "archiveSha256": ARCHIVE_SHA, "compilerVersion": "2.2.0", "compilerSha256": COMPILER_SHA,
               "scope": ["explicit-wait-original-body", "implicit-settle-original-driver-call", "scoped-original-screenshot-call", "scoped-original-static-screen-call", "scoped-original-image-decode", "scoped-original-image-comparison"],
               "loadedImage": "unattested", "deadlinesChanged": False, "originalMatrixUnchanged": True,
               "comparisonCpu": "read-only-current-thread-or-null"}

    def save():
        (output / "staging-proof.json").write_text(json.dumps(receipt, indent=2) + "\n")

    def command(name, argv, timeout=120):
        # Build controls only. These bounds never alter the original native requests.
        result = subprocess.run([str(a) for a in argv], env=env, capture_output=True, timeout=timeout)
        for extension, value in [("out", result.stdout), ("err", result.stderr), ("exit", str(result.returncode).encode())]:
            with (private / (name + "." + extension)).open("xb") as stream:
                stream.write(value)
        return result

    save()
    try:
        version = command("java-version", [java, "-XshowSettings:properties", "-version"])
        assert version.returncode == 0 and re.search(rb"java.specification.version\s*=\s*17\b", version.stderr), "Java17 required"
        receipt["javaVersionOutputSha256"] = sha(version.stderr)
        extract(archive, private / "original", 1024**3)
        extract(compiler, private / "compiler", 512 * 1024**2)
        original_cli = private / "original" / "maestro"
        lib = original_cli / "lib"
        assert sha(regular(lib / "maestro-client.jar", 32 * 1024**2)) == CLIENT_SHA
        assert sha(regular(lib / "maestro-cli-2.10.0.jar", 128 * 1024**2)) == CLI_SHA
        assert sha(regular(lib / "maestro-ios-driver.jar", 180 * 1024**2)) == IOS_SHA
        jars = sorted(lib.glob("*.jar"))
        assert len(jars) == 194 and len(list(original_cli.rglob("*.jar"))) == 195
        cp = os.pathsep.join(str(p) for p in jars)
        code = private / "source"
        code.mkdir()
        (code / "Maestro.kt").write_bytes(patched)
        (code / "IOSDriver.kt").write_bytes(patched_driver)
        (code / "ScreenshotUtils.kt").write_bytes(patched_image)
        includes = Path(__file__).parent
        for name, target in [("Observation.kt.inc", "QualificationSettleObservation.kt"), ("Controls.kt.inc", "QualificationSettleControls.kt")]:
            (code / target).write_bytes(regular(includes / name, 32 * 1024))
        classes = private / "classes"
        classes.mkdir()
        result = command("compile", [java, "-cp", str(private / "compiler/kotlinc/lib/*"), "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
                         "-no-stdlib", "-no-reflect", "-classpath", cp, "-Xjdk-release=17",
                         "-Xfriend-paths=" + str(lib / "maestro-client.jar"), "-module-name", "maestro-client", "-d", classes,
                         *sorted(code.glob("*.kt"))])
        assert result.returncode == 0, "Pinned source compilation failed"
        # Only the three original class families and new observer enter the private CLI copy.
        observed_jar = private / "observed-client.jar"
        receipt["client"] = rewrite_client(lib / "maestro-client.jar", observed_jar, classes)
        fixture = private / "fixture-classes"
        fixture.mkdir()
        for file in classes.rglob("*.class"):
            relative = file.relative_to(classes)
            if relative.as_posix() == "maestro/Marker.class" or relative.as_posix().startswith(("maestro/QualificationSettleControls", "maestro/QualificationSettleObservation")):
                target = fixture / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(file.read_bytes())
        temp = private / "fixture-tmp"
        temp.mkdir()
        controls = [java, "-Djava.awt.headless=true", "-Djava.io.tmpdir=" + str(temp)]
        main = "maestro.QualificationSettleControlsKt"
        baseline = command("baseline-controls", controls + ["-Dbaseline=true", "-cp", str(fixture) + os.pathsep + cp, main], 40)
        assert baseline.returncode == 0 and b"SETTLE_CONTROLS_PASS" in baseline.stdout, "Actual original-package controls failed"
        negative = command("baseline-red", controls + ["-cp", str(fixture) + os.pathsep + cp, main], 40)
        assert negative.returncode != 0 and b"MISSING_SETTLE_PHASES" in negative.stderr, "Missing-stage negative control failed"
        observed_cp = str(observed_jar) + os.pathsep + cp
        positive = command("observed-controls", controls + ["-cp", str(fixture) + os.pathsep + observed_cp, main], 40)
        assert positive.returncode == 0 and b"stalledSinkDidNotHoldOriginal=true" in positive.stdout and b"cpuControlsPassed=true" in positive.stdout, "Observed forwarding controls failed"
        inner_baseline = private / "inner-baseline"
        with zipfile.ZipFile(lib / "maestro-client.jar") as original:
            for name in original.namelist():
                if re.match(r"^maestro/drivers/IOSDriver(?:\$|\.class)", name):
                    target = inner_baseline / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(original.read(name))
        inner_red = command("inner-stage-red", controls + ["-cp", str(inner_baseline) + os.pathsep + str(fixture) + os.pathsep + observed_cp, main], 40)
        assert inner_red.returncode != 0 and b"MISSING_INNER_SETTLE_PHASES" in inner_red.stderr, "Original IOSDriver missing-stage negative failed"
        image_baseline = private / "image-baseline"
        with zipfile.ZipFile(lib / "maestro-client.jar") as original:
            for name in original.namelist():
                if re.match(r"^maestro/utils/ScreenshotUtils(?:\$|\.class)", name):
                    target = image_baseline / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(original.read(name))
        image_red = command("image-stage-red", controls + ["-cp", str(image_baseline) + os.pathsep + str(fixture) + os.pathsep + observed_cp, main], 40)
        assert image_red.returncode != 0 and b"MISSING_IMAGE_PHASES" in image_red.stderr, "Original ScreenshotUtils missing-stage negative failed"
        abi_classes = ["maestro.Maestro", "maestro.drivers.IOSDriver", "maestro.utils.ScreenshotUtils", "maestro.utils.ScreenshotUtils$Companion"]
        original_abi = command("original-abi", [javap, "-classpath", cp, "-public", "-s", *abi_classes])
        observed_abi = command("observed-abi", [javap, "-classpath", observed_cp, "-public", "-s", *abi_classes])
        assert original_abi.returncode == observed_abi.returncode == 0 and original_abi.stdout == observed_abi.stdout, "Public ABI drift"
        # The executable launcher, CLI JAR and packaged Swift runner remain original bytes.
        staged_cli = output / "maestro"
        original_cli.rename(staged_cli)
        target = staged_cli / "lib/maestro-client.jar"
        target.write_bytes(observed_jar.read_bytes())
        receipt.update({"status": "prepared", "controls": {"originalPackage": True, "missingStageRed": True,
                        "observedPackage": True, "innerStageRed": True, "imageStageRed": True, "stalledSink": True, "publicABIExact": True, "comparisonCpu": True},
                        "cliJarSha256": sha((staged_cli / "lib/maestro-cli-2.10.0.jar").read_bytes()),
                        "nativeJarSha256": sha((staged_cli / "lib/maestro-ios-driver.jar").read_bytes()),
                        "launcherSha256": sha((staged_cli / "bin/maestro").read_bytes())})
        save()
    except BaseException as error:
        receipt["status"] = "failed"
        receipt["failure"] = "owned-input-build-or-control-gate"
        trace = error.__traceback__
        while trace and trace.tb_next:
            trace = trace.tb_next
        receipt["failureLine"] = trace.tb_lineno if trace else None
        receipt["failureKind"] = type(error).__name__ if type(error).__name__ in ["AssertionError", "FileNotFoundError", "TimeoutExpired"] else "unknown"
        save()
        raise
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for argument in ["source", "archive", "compiler", "output", "java-home"]:
        parser.add_argument("--" + argument, required=True)
    try:
        stage(parser.parse_args())
    except Exception:
        print("Qualification source-copy staging failed; finite receipt and private build logs retained.")
        sys.exit(1)
    print("Prepared qualification-only source copy; ordinary CLI and native matrix unchanged.")
