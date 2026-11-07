"""CPU-only replay of retained binary region-work input; never launches an app/driver."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import zipfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("comparison_build", Path(__file__).with_name("build.py"))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


def profiled(source):
    replacements = [
        ("long countOfDifferentPixels = populateTheMatrixOfTheDifferences();",
         "long countOfDifferentPixels = ProfileHooks.measure(1, () -> populateTheMatrixOfTheDifferences());"),
        ("        groupRegions();", "        ProfileHooks.group(() -> groupRegions());"),
        ("        List<Rectangle> rectangles = new ArrayList<>();",
         "        long regionStart = System.nanoTime(), regionCpu = ProfileHooks.cpu();\n        List<Rectangle> rectangles = new ArrayList<>();"),
        ("        return mergeRectangles(mergeRectangles(rectangles));",
         "        ProfileHooks.end(3, regionStart, regionCpu);\n        return ProfileHooks.measure(4, () -> mergeRectangles(mergeRectangles(rectangles)));"),
    ]
    text = source.decode("utf8")
    for old, new in replacements:
        assert text.count(old) == 1
        text = text.replace(old, new)
    restored = text
    for old, new in replacements:
        restored = restored.replace(new, old)
    assert restored.encode() == source
    return text.encode()


def replay(args):
    output = Path(args.output).absolute()
    assert not output.exists() and output.parent.is_dir()
    metadata_bytes = build.regular(Path(args.state), 8192)
    state = json.loads(metadata_bytes)
    metadata = state["metadata"]
    proof = json.loads(build.regular(Path(args.proof), 65536))
    assert proof["status"] == "prepared" and proof["originalJarSha256"] == build.JAR_SHA
    assert proof.get("captureControls", {}).get("originalMissingCaptureRed") is True
    if args.fixture_control:
        assert proof["source"] is None and metadata["source"] == "a" * 40
    else:
        assert all(metadata[k] == proof[p] for k, p in [("source", "source"), ("runId", "runId"), ("attempt", "attempt")])
    original = Path(args.original_jar).resolve()
    candidate = Path(args.candidate_jar).resolve()
    assert build.sha(build.regular(original, 1_000_000)) == build.JAR_SHA
    assert build.sha(build.regular(candidate, 1_000_000)) == proof["jar"]["sha256"]
    archive = Path(args.source_archive)
    assert build.sha(build.regular(archive, 200000)) == build.SOURCE_ARCHIVE_SHA
    with zipfile.ZipFile(archive) as z:
        source = z.read(build.SOURCE)
    assert build.sha(source) == build.SOURCE_SHA
    changed_source = build.transform(source, capture=True)
    assert build.sha(changed_source) == proof["patchedSourceSha256"]
    java_home = Path(args.java_home).resolve()
    java, javac = [java_home / "bin" / (n + (".exe" if os.name == "nt" else "")) for n in ["java", "javac"]]
    output.mkdir(mode=0o700)
    def command(name, argv, bound=90, input=None):
        env = {**os.environ, "THIRDROLL_COMPARISON_CAPTURE": "0"}
        r = subprocess.run(list(map(str, argv)), input=input, env=env, capture_output=True, timeout=bound)
        for ext, data in [("out", r.stdout), ("err", r.stderr), ("exit", str(r.returncode).encode())]:
            with (output / (name + "." + ext)).open("xb") as f:
                f.write(data)
        assert r.returncode == 0, "owned offline validation failed; original outputs retained"
        return r.stdout
    # The same public parser rechecks schema/privacy, exact bits/count/hash/config
    # and clock bounds. No output includes matrix values or user content.
    script = "import {readFileSync} from 'node:fs';import {validateState} from " + json.dumps(Path(__file__).with_name("state.mjs").as_uri()) + ";"
    script += "const s=JSON.parse(readFileSync(process.argv[2],'utf8'));const m=s.metadata;const b=readFileSync(process.argv[3]);"
    script += "validateState(m,b,{source:m.source,runId:m.runId,attempt:m.attempt,route:m.route},[]);console.log('STATE_VALIDATED');"
    command("validate", ["node", "--input-type=module", "-", args.state, args.binary], input=script.encode())
    for name, content in [("rebuilt", source), ("profile", profiled(changed_source))]:
        d = output / name
        d.mkdir()
        (d / "ImageComparison.java").write_bytes(content)
        extra = []
        if name == "profile":
            (d / "ProfileHooks.java").write_bytes(build.regular(Path(__file__).with_name("ProfileHooks.java.inc"), 16384))
            extra.append(d / "ProfileHooks.java")
            # Compile-only bridge for the disabled observation branch. Its call
            # counter must remain zero. No driver/observer JAR is loaded offline.
            bridge = d / "maestro/QualificationComparisonCapture.java"
            bridge.parent.mkdir()
            bridge.write_text("package maestro; public class QualificationComparisonCapture { public static int calls; "
                              "public static void snapshot(int[][] m,long n,int c,int r,int t,Integer s,double a){calls++;} }")
            extra.append(bridge)
        command("compile-" + name, [javac, "--release", "8", "-g", "-cp", original,
                                   "-d", d, d / "ImageComparison.java", *extra])
    (output / "ReplayMatrix.java").write_bytes(build.regular(Path(__file__).with_name("ReplayMatrix.java.inc"), 16384))
    command("compile-replay", [javac, "--release", "17", "-d", output, output / "ReplayMatrix.java"])
    data = command("replay", [java, "-Xmx512m", "-XX:-OmitStackTraceInFastThrow", "-Djava.awt.headless=true", "-cp", output,
                             "ReplayMatrix", original, output / "rebuilt", candidate, output / "profile", args.binary,
                             str(metadata["width"]), str(metadata["height"])], bound=600)
    rows = [json.loads(line) for line in data.decode().splitlines()]
    result = next(row for row in rows if row["kind"] == "result")
    assert result["regionOracleEquivalent"] and result["fullComparatorEquivalence"] is False
    trials = [row for row in rows if row["kind"] == "trial"]
    medians = {}
    for name in ["release", "unmodified-rebuild", "candidate", "profiled-candidate"]:
        selected = [row for row in trials if row["mode"] == name]
        assert len(selected) == 4
        medians[name] = {"elapsedNs": statistics.median(row["elapsedNs"] for row in selected),
                         "cpuNs": statistics.median(row["cpuNs"] for row in selected) if all(row["cpuNs"] is not None for row in selected) else None}
    report = {"kind": "binary-region-work-offline-replay", "source": metadata["source"], "runId": metadata["runId"],
              "attempt": metadata["attempt"], "route": metadata["route"], "id": metadata["id"], "pid": metadata["pid"],
              "inputSha256": metadata["sha256"], "originalJarSha256": build.JAR_SHA, "candidateJarSha256": proof["jar"]["sha256"],
              "fixtureControl": args.fixture_control, "result": result, "medians": medians,
              "profile": next(row for row in rows if row["kind"] == "profile"),
              "limits": ["binary surrogate predicate cost is not original pixel conversion cost", "region-work oracle only; no full-comparator equivalence",
                         "profiled candidate is offline-only source instrumentation; same outputs checked", "no native timing/cause or host-pressure transfer"]}
    (output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ["state", "binary", "proof", "original-jar", "candidate-jar", "source-archive", "java-home", "output"]:
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--fixture-control", action="store_true")
    try:
        print(json.dumps(replay(parser.parse_args())))
    except Exception:
        print("Offline comparison-state replay unavailable; owned input/control logs retained.")
        sys.exit(1)
