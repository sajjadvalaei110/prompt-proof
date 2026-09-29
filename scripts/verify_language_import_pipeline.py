#!/usr/bin/env python3
"""Verify the shipped language picker against an isolated packaged backend and Chromium."""
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


def main():
    output = ROOT / "build/language-import"
    output.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="run-", dir=output))
    processes = []
    with tempfile.TemporaryDirectory(prefix="code-atlas-language-fixture-") as temporary:
        fixture = Path(temporary) / "spring-project"
        shutil.copytree(ROOT / "test-fixtures/spring-project", fixture)
        before = runner.hashes(fixture)
        port, debug, offline = runner.free_port(), runner.free_port(), runner.free_port()
        base, debugger = f"http://127.0.0.1:{port}", f"http://127.0.0.1:{debug}"
        try:
            with (run / "application.log").open("w") as log:
                processes.append(subprocess.Popen([
                    os.environ.get("JAVA", "java"), "-jar", str(runner.JAR),
                    f"--server.port={port}", f"--codeatlas.data-dir={run}",
                    f"--codeatlas.model.base-url=http://127.0.0.1:{offline}/v1",
                    "--codeatlas.model.model-id=offline",
                ], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT))
            runner.await_url(base + "/api/health")
            with (run / "chromium.log").open("w") as log:
                processes.append(subprocess.Popen([
                    os.environ.get("CHROMIUM", "/snap/bin/chromium"), "--headless=new",
                    "--no-sandbox", "--disable-dev-shm-usage", "--remote-allow-origins=*",
                    f"--remote-debugging-port={debug}", f"--user-data-dir={run}/chrome", "about:blank",
                ], stdout=log, stderr=subprocess.STDOUT))
            runner.await_url(debugger + "/json/version")
            subprocess.run([
                "node", "scripts/verify-language-import-ui.mjs", base, debugger, str(fixture), str(run),
            ], cwd=ROOT, check=True, timeout=120)
            assert before == runner.hashes(fixture), "Source fixture changed"
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
