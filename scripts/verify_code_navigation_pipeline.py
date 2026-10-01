#!/usr/bin/env python3
"""Verify source-viewer navigation (ADR 0013) against the packaged app and real Chromium.

Two copies of test-fixtures/scip-gradle-project are imported through the real import form: one with
the scip-java engine (its Gradle build runs in Code Atlas's private copy, with the consent box ticked)
and one with the default JavaParser engine. Both copies are hashed before and after to prove they stay
read-only. The model base URL points at a closed port, so nothing here can be mistaken for live-model
verification. Needs Java 21, Node 22, Python 3, a `gradle` on PATH and `./gradlew installScipJava`.
"""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("runner", ROOT / "scripts/verify_stable_graph_pipeline.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def chromium():
    if os.environ.get("CHROMIUM"):
        return os.environ["CHROMIUM"]
    for candidate in ("/opt/pw-browsers/chromium", "/snap/bin/chromium"):
        if Path(candidate).exists():
            return candidate
    return "chromium"


def main():
    scip_home = ROOT / "data/tools/scip-java"
    if not (scip_home / "lib").is_dir():
        raise SystemExit("scip-java is not installed: run ./gradlew installScipJava first")
    output = ROOT / "build/code-navigation"
    output.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="run-", dir=output))
    processes = []
    with tempfile.TemporaryDirectory(prefix="code-atlas-navigation-fixture-") as temporary:
        scip = Path(temporary) / "scip-project"
        plain = Path(temporary) / "javaparser-project"
        shutil.copytree(ROOT / "test-fixtures/scip-gradle-project", scip)
        shutil.copytree(ROOT / "test-fixtures/scip-gradle-project", plain)
        before = (runner.hashes(scip), runner.hashes(plain))
        port, debug, offline = runner.free_port(), runner.free_port(), runner.free_port()
        base, debugger = f"http://127.0.0.1:{port}", f"http://127.0.0.1:{debug}"
        try:
            with (run / "application.log").open("w") as log:
                processes.append(subprocess.Popen([
                    os.environ.get("JAVA", "java"), "-jar", str(runner.JAR),
                    f"--server.port={port}", f"--codeatlas.data-dir={run}",
                    f"--codeatlas.indexers.scip-java.home={scip_home}",
                    f"--codeatlas.model.base-url=http://127.0.0.1:{offline}/v1",
                    "--codeatlas.model.model-id=offline",
                ], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT))
            runner.await_url(base + "/api/health")
            with (run / "chromium.log").open("w") as log:
                processes.append(subprocess.Popen([
                    chromium(), "--headless=new",
                    "--no-sandbox", "--disable-dev-shm-usage", "--remote-allow-origins=*",
                    f"--remote-debugging-port={debug}", f"--user-data-dir={run}/chrome", "about:blank",
                ], stdout=log, stderr=subprocess.STDOUT))
            runner.await_url(debugger + "/json/version")
            subprocess.run([
                "node", "scripts/verify-code-navigation-ui.mjs", base, debugger, str(scip), str(plain), str(run),
            ], cwd=ROOT, check=True, timeout=900)
            assert before == (runner.hashes(scip), runner.hashes(plain)), "Source fixture changed"
            print("Evidence:", run)
        finally:
            for process in reversed(processes):
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == "__main__":
    main()
