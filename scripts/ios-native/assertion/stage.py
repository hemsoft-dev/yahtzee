"""Build one hash-pinned, qualification-only matcher-result observation copy."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

REF = "14a408335e17a090df1e26bdbeaf80d8122a8fd8"
ORCHESTRA = "e7c42f0bba4e837555b11a536a9e9b77ef35b8f89e628422c846940d7624c441"
JARS = {
    "maestro-orchestra.jar": "0ecf6dd5fdf1ad49ff0d819296c14e905053600dfcd59cbdf07ec6f3f6ca106a",
    "maestro-orchestra-models.jar": "3840a5ca34130aed81bcdd794507b4ff1a73f72367ae71d415716da8529da3ba",
    "maestro-client.jar": "acc437d88e4843f2e786c332ecbcd0a09267f9f47a155cc0460a0e98dc928104",
    "maestro-cli-2.10.0.jar": "edf1a9ec465f1fbe7a325d2f166e1135f19deeb671f9dd76aeedf8e6f887845c",
    "maestro-ios-driver.jar": "1a4e4582e7b415167782711c04b914df878899d04757a2de82c3bf7a5b4c99f1",
}
COMPILER = "1adb6f1a5845ba0aa5a59e412e44c8e405236b957de1a9683619f1dca3b16932"
ARCHIVE = "29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def regular(path, cap):
    assert path.is_file() and not path.is_symlink() and path.stat().st_size <= cap
    return path.read_bytes()


def file_sha(path, cap):
    assert path.is_file() and not path.is_symlink() and path.stat().st_size <= cap
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def transform(data, patch):
    assert sha(data) == ORCHESTRA == patch["originalSHA256"]
    assert patch["v"] == 1 and patch["ref"] == REF
    assert patch["path"] == "maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt"
    text = data.decode("utf8")
    assert isinstance(patch["edits"], list) and 1 <= len(patch["edits"]) <= 64
    cursor, parts, inverse = 0, [], []
    length = 0
    for edit in patch["edits"]:
        a, b, old, new = (edit[k] for k in ["start", "end", "old", "new"])
        assert type(a) is int and type(b) is int and cursor <= a <= b <= len(text)
        assert isinstance(old, str) and isinstance(new, str) and text[a:b] == old
        parts.extend([text[cursor:a], new])
        length += a - cursor
        inverse.append((length, length + len(new), old))
        length += len(new)
        cursor = b
    parts.append(text[cursor:])
    result = "".join(parts)
    assert sha(result.encode()) == patch["patchedSHA256"]
    restored = result
    for a, b, old in reversed(inverse):
        restored = restored[:a] + old + restored[b:]
    assert restored.encode() == data, "Pinned source inverse differs"
    return result.encode()


def family(name):
    return bool(re.match(r"^maestro/orchestra/(?:Orchestra(?:\$|\.class)|QualificationAssertResult(?:\$|\.class))", name))


def stage(args):
    root = Path(args.output).absolute()
    root.mkdir(mode=0o700)
    private = root / ".private"
    private.mkdir(mode=0o700)
    cli, source, java_home = (Path(getattr(args, k)).resolve() for k in ["cli_root", "source", "java_home"])
    lib = cli / "lib"
    here = Path(__file__).parent
    proof = {"v": 1, "kind": "qualification-original-assertion-result", "status": "building", "upstreamSource": REF,
             "source": None, "runId": os.environ.get("GITHUB_RUN_ID"), "attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
             "loadedImage": "unattested", "nativeQueryIdentity": "unavailable", "oracleChanged": False}

    def save():
        (root / "proof.json").write_text(json.dumps(proof, indent=2) + "\n")

    def command(name, argv, limit=90):
        proof["lastCommand"] = name
        save()
        try:
            result = subprocess.run([str(x) for x in argv], capture_output=True, timeout=limit)
        except subprocess.TimeoutExpired:
            proof["commandOutcome"] = "timeout"
            save()
            raise
        proof["commandOutcome"] = "returned"
        proof["commandExit"] = result.returncode
        save()
        for extension, value in [("out", result.stdout), ("err", result.stderr), ("exit", str(result.returncode).encode())]:
            with (private / (name + "." + extension)).open("xb") as file:
                file.write(value)
        return result

    save()
    try:
        rev = command("source-commit", ["git", "rev-parse", "HEAD"])
        assert rev.returncode == 0 and re.fullmatch(rb"[a-f0-9]{40}\s*", rev.stdout)
        proof["source"] = rev.stdout.decode().strip()
        if os.environ.get("GITHUB_ACTIONS") == "true":
            assert all(isinstance(proof[k], str) and re.fullmatch(r"[1-9][0-9]{0,19}", proof[k]) for k in ["runId", "attempt"])
        for name, expected in JARS.items():
            assert sha(regular(lib / name, 180 * 1024**2)) == expected, "Original pinned orchestration libraries required"
        assert Path(args.archive).stat().st_size == 314828521
        assert file_sha(Path(args.archive), 314828521) == ARCHIVE
        assert file_sha(Path(args.compiler), 128 * 1024**2) == COMPILER
        original = regular(source / "maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt", 128 * 1024)
        patch = json.loads(regular(here / "source.patch.json", 16384))
        patched = transform(original, patch)
        proof.update({"originalSourceSHA256": ORCHESTRA, "patchedSourceSHA256": sha(patched), "patchSHA256": sha(regular(here / "source.patch.json", 16384)),
                      "observerSHA256": sha(regular(here / "Result.kt.inc", 16384)), "sourceInverseExact": True})
        # Reuse the existing reviewed bounded ZIP extraction, with no dependency install.
        spec = importlib.util.spec_from_file_location("assertion_zip_limits", here.parent / "settle/stage.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.extract(Path(args.compiler), private / "compiler", 512 * 1024**2)
        code, classes, fixtures = (private / k for k in ["code", "classes", "fixtures"])
        for directory in [code, classes, fixtures]:
            directory.mkdir()
        (code / "Orchestra.kt").write_bytes(patched)
        for name, target in [("Result.kt.inc", "QualificationAssertResult.kt"), ("Controls.kt.inc", "QualificationAssertControls.kt")]:
            (code / target).write_bytes(regular(here / name, 16384))
        cp = os.pathsep.join(str(p) for p in sorted(lib.glob("*.jar")))
        all_files = [p for p in cli.rglob("*") if p.is_file()]
        assert len(all_files) <= 1024 and sum(p.stat().st_size for p in all_files) <= 1024**3
        cli_hashes = {p.relative_to(cli).as_posix(): file_sha(p, 180 * 1024**2) for p in all_files}
        java, javap = java_home / "bin/java", java_home / "bin/javap"
        version = command("java-version", [java, "-version"])
        assert version.returncode == 0 and re.search(rb'version "17\.', version.stderr)
        result = command("compile", [java, "-cp", private / "compiler/kotlinc/lib/*", "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
                         "-no-stdlib", "-no-reflect", "-classpath", cp, "-Xjdk-release=17", "-Xfriend-paths=" + str(lib / "maestro-orchestra.jar"),
                         "-module-name", "maestro-orchestra", "-d", classes, *sorted(code.glob("*.kt"))])
        assert result.returncode == 0, "Pinned observation compilation failed"
        for file in classes.rglob("*.class"):
            relative = file.relative_to(classes)
            if not relative.name.startswith("Orchestra"):
                target = fixtures / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(file.read_bytes())
        main = "maestro.orchestra.QualificationAssertControlsKt"
        flow = here / "flow4.yaml.fixture"
        assert sha(regular(flow, 4096)) == "e907175ef83d139cb9b9eae9800a683fac40b3f966754c277a993ffb6b5647c4"
        for name, options, first, expected in [("baseline", ["-Dbaseline=true"], fixtures, True),
                                                ("missing-red", ["-Dbaseline=true", "-DexpectObservation=true"], fixtures, False),
                                                ("observed", [], classes, True)]:
            result = command(name, [java, "-Djava.awt.headless=true", *options, "-cp", str(first) + os.pathsep + cp, main, flow], 60)
            assert (result.returncode == 0) == expected, "Actual original/observed assertion control failed"
            if not expected:
                assert b"MISSING_ASSERTION_MATCH_RESULT" in result.stderr, "Negative control failed for another reason"
        original_abi = command("original-abi", [javap, "-public", "-s", "-classpath", lib / "maestro-orchestra.jar", "maestro.orchestra.Orchestra"])
        new_abi = command("observed-abi", [javap, "-public", "-s", "-classpath", classes, "maestro.orchestra.Orchestra"])
        assert original_abi.returncode == new_abi.returncode == 0
        pattern = rb"  public[^\n]*\n    descriptor: [^\n]*"
        before, after = (set(re.findall(pattern, value.stdout)) for value in [original_abi, new_abi])
        assert before <= after, "Original public descriptor removed or changed"
        added = after - before
        assert len(added) == 4 and all(b"access$" in x and b"QualificationAssertResult$Context" in x for x in added)
        additions = {p.relative_to(classes).as_posix(): p.read_bytes() for p in classes.rglob("*.class") if family(p.relative_to(classes).as_posix())}
        candidate = private / "observed-orchestra.jar"
        with zipfile.ZipFile(lib / "maestro-orchestra.jar") as old, zipfile.ZipFile(candidate, "x", zipfile.ZIP_DEFLATED) as new:
            originals = {n for n in old.namelist() if family(n)}
            # Kotlin renumbers the private state machines when overloads are added.
            # Keep their original bytes only after excluding references from the rebuilt
            # family and retained external classes. No old continuation is substituted
            # for a new state machine or given a new descriptor.
            compatibility = originals - additions.keys()
            expected = {"maestro/orchestra/Orchestra$" + name + ".class" for name in [
                "assertConditionCommand$1", "evaluateCondition$1", "evaluateCondition$5$disappeared$1", "executeCommand$1", "findElement$1"]}
            assert compatibility == expected, "Unexpected compiler class-family change"
            candidates = list(additions.values()) + [old.read(n) for n in old.namelist() if n.endswith(".class") and not family(n)]
            for name in compatibility:
                token = name.removesuffix(".class")
                assert all(token.encode() not in data and token.replace("/", ".").encode() not in data for data in candidates), "Retained continuation is referenced by active code"
                additions[name] = old.read(name)
            assert originals <= additions.keys()
            for entry in old.infolist():
                if not family(entry.filename):
                    new.writestr(entry, old.read(entry.filename))
            for name, value in additions.items():
                new.writestr(name, value)
        with zipfile.ZipFile(lib / "maestro-orchestra.jar") as old, zipfile.ZipFile(candidate) as new:
            unrelated = [n for n in old.namelist() if not family(n)]
            assert all(old.read(n) == new.read(n) for n in unrelated)
            assert all(old.read(n) == new.read(n) for n in compatibility)
        packaged = command("packaged-observed", [java, "-Djava.awt.headless=true", "-cp", str(candidate) + os.pathsep + str(fixtures) + os.pathsep + cp, main, flow], 60)
        assert packaged.returncode == 0 and b"ASSERTION_MATCH_CONTROLS_PASS" in packaged.stdout, "Actual packaged observation controls failed"
        proof.update({"status": "prepared", "originalOrchestraSHA256": JARS["maestro-orchestra.jar"], "orchestraSHA256": sha(candidate.read_bytes()),
                      "originalPublicDescriptorsPreserved": len(before), "additionalSyntheticBridges": len(added),
                      "unrelatedEntriesByteIdentical": len(unrelated), "compiledFamilyEntries": len(additions),
                      "originalPrivateContinuationsRetained": len(compatibility), "compatibilityReferencesAbsent": True,
                      "controls": "actual-original-baseline/missing-result-RED/observed-GREEN", "geometry": "unavailable/not-traversed"})
        # Only this private job-local copy changes, after controls; retain its original bytes.
        (private / "original-orchestra.jar").write_bytes((lib / "maestro-orchestra.jar").read_bytes())
        (lib / "maestro-orchestra.jar").write_bytes(candidate.read_bytes())
        after_files = {p.relative_to(cli).as_posix(): file_sha(p, 180 * 1024**2) for p in cli.rglob("*") if p.is_file()}
        assert cli_hashes.keys() == after_files.keys()
        assert all(cli_hashes[p] == after_files[p] for p in cli_hashes if p != "lib/maestro-orchestra.jar")
        proof["otherCliFilesByteIdentical"] = len(cli_hashes) - 1
        for name, expected in JARS.items():
            assert sha(regular(lib / name, 180 * 1024**2)) == (proof["orchestraSHA256"] if name == "maestro-orchestra.jar" else expected)
        save()
    except BaseException:
        proof["status"] = "failed"
        save()
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for key in ["source", "cli-root", "java-home", "archive", "compiler", "output"]:
        parser.add_argument("--" + key, required=True)
    stage(parser.parse_args())
    print("Prepared qualification-only original matcher-result observation; no native acceptance claimed.")
