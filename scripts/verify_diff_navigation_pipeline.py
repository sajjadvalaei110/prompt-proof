#!/usr/bin/env python3
"""Verify go to definition inside the Changes diff (ADR 0014) and the repository root (ADR 0015).

A scratch copy of test-fixtures/scip-gradle-project becomes a Git repository with one base commit; then
its working tree changes inside the `app` module: an added file (Farewell.java) and an edited line in
GreetingService.java. The *module* `app` is imported through the real form with the repository root set to
the copy, the scip-java engine and the consent box ticked, so the Gradle build is found under the root and
review captures read Git from it. Everything is driven in packaged-app Chromium with real CDP input.

The whole copy (including .git) is hashed before and after; the only file that may differ afterwards is the
one the UI driver edits itself to make a file stale (Main.java, an edit a user makes between analysis and
Recompare). The model base URL points at a closed port, so nothing here is live-model verification.
Needs Java 21, Node 22, Python 3, git, a `gradle` on PATH and `./gradlew installScipJava`.
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

APP = "app/src/main/java/com/example/app"
FAREWELL = """package com.example.app;

import com.example.core.Greeter;

public class Farewell {
    private final GreetingService service = new GreetingService();

    public String bye(Greeter greeter, String name) {
        return greeter.greet(name) + ", goodbye";
    }
}
"""
OLD_LINE = "            result.add(greeter.greet(name));\n"
NEW_LINE = "            result.add(new Farewell().bye(greeter, name));\n"
STALE_MAIN = "\n// edited after the last analysis\n"


def chromium():
    if os.environ.get("CHROMIUM"):
        return os.environ["CHROMIUM"]
    for candidate in ("/opt/pw-browsers/chromium", "/snap/bin/chromium"):
        if Path(candidate).exists():
            return candidate
    return "chromium"


def git(repo, *args):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL="/dev/null", GIT_TERMINAL_PROMPT="0")
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, env=env).stdout.strip()


def make_fixture(repo):
    shutil.copytree(ROOT / "test-fixtures/scip-gradle-project", repo)
    git(repo, "init", "--initial-branch=main")
    git(repo, "config", "user.name", "Diff Navigation")
    git(repo, "config", "user.email", "diff-navigation@example.invalid")
    git(repo, "config", "commit.gpgsign", "false")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "base")
    base = git(repo, "rev-parse", "HEAD")
    (repo / APP / "Farewell.java").write_text(FAREWELL)
    service = repo / APP / "GreetingService.java"
    text = service.read_text()
    assert OLD_LINE in text, "fixture line to edit is missing"
    service.write_text(text.replace(OLD_LINE, NEW_LINE))
    return base


def main():
    scip_home = ROOT / "data/tools/scip-java"
    if not (scip_home / "lib").is_dir():
        raise SystemExit("scip-java is not installed: run ./gradlew installScipJava first")
    output = ROOT / "build/diff-navigation"
    output.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="run-", dir=output))
    processes = []
    with tempfile.TemporaryDirectory(prefix="code-atlas-diff-navigation-") as temporary:
        repo = Path(temporary) / "repo"
        base_oid = make_fixture(repo)
        before = runner.hashes(repo)
        main_java = repo / APP / "Main.java"
        expected_main = main_java.read_text() + STALE_MAIN
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
                "node", "scripts/verify-diff-navigation-ui.mjs", base, debugger, str(repo), base_oid, str(run),
            ], cwd=ROOT, check=True, timeout=1200)
            after = runner.hashes(repo)
            stale_key = str(Path(APP) / "Main.java")
            assert main_java.read_text() == expected_main, "Main.java was not edited exactly as the driver intends"
            changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
            assert changed == [stale_key], f"Source fixture changed beyond the driver's own edit: {changed}"
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
