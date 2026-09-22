#!/usr/bin/env python3
"""Packaged end-to-end acceptance for the Git-review-on-the-Code-map feature (Changes toggle,
per-tab review mode across New tab/Clone tab, collapsible map-heading, git-style diff viewer).

The fixture is created at runtime with a committed base, a staged modification and new class,
an unstaged deletion, and untracked Java and non-Java files. The packaged application imports and
analyzes it through the workspace API; Chromium then opens the actual Code-map Changes UI. The
workspace and its Git index are hashed before and after the full run to catch writes to the source
repository. The app database, browser profile, logs, report, and screenshots live in an isolated
output directory. No user repository or model endpoint is used.

Usage:
    python3 scripts/verify_git_review_pipeline.py [outputDir]

    CHROMIUM=<path> overrides the browser (default /snap/bin/chromium).
    JAVA=<path> overrides the runtime (default java on PATH).
"""
import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'build' / 'git-review'
JAR = ROOT / 'build' / 'libs' / 'code-atlas-0.1.0-SNAPSHOT.jar'


def free_port():
    with socket.socket() as connection:
        connection.bind(('127.0.0.1', 0))
        return connection.getsockname()[1]


def await_url(url):
    for _ in range(180):
        try:
            with urllib.request.urlopen(url, timeout=1):
                return
        except Exception:
            time.sleep(.2)
    raise RuntimeError(f'Service did not start: {url}')


def api(base, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        base + path,
        data=data,
        method='GET' if body is None else 'POST',
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read() or b'null')


def tree_hash(directory):
    """Hash paths, file content and modes, and symlink targets under a directory."""
    digest = hashlib.sha256()
    for path in sorted(directory.rglob('*')):
        relative = str(path.relative_to(directory)).encode()
        if path.is_dir() and not path.is_symlink():
            digest.update(b'D\0' + relative + b'\0')
        if path.is_symlink():
            digest.update(b'L\0' + relative + b'\0' + os.readlink(path).encode() + b'\0')
        elif path.is_file():
            mode = path.stat().st_mode & 0o777
            digest.update(b'F\0' + relative + b'\0' + oct(mode).encode() + b'\0')
            digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def git(fixture, *args):
    env = os.environ.copy()
    env.update({'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull,
                'GIT_TERMINAL_PROMPT': '0', 'LC_ALL': 'C'})
    return subprocess.run(['git', '-C', str(fixture), *args], env=env, check=True,
                          text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.strip()


def write(fixture, relative, content):
    path = fixture / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8', newline='\n')


def make_fixture(fixture):
    fixture.mkdir(parents=True)
    git(fixture, 'init', '--quiet', '--initial-branch=review-base')
    git(fixture, 'config', 'user.name', 'Code Atlas Acceptance')
    git(fixture, 'config', 'user.email', 'code-atlas-acceptance@example.invalid')
    git(fixture, 'config', 'commit.gpgsign', 'false')

    write(fixture, 'src/main/java/review/Hub.java', '''package review;

public class Hub {
    public String changed() {
        return new OldDep().read();
    }

    public String sibling() {
        return new KeepDep().read(1) + new KeepDep().read(2) + new support.Stable().value();
    }
}
''')
    write(fixture, 'src/main/java/review/OldDep.java', '''package review;

public class OldDep {
    public String read() {
        return "old";
    }
}
''')
    write(fixture, 'src/main/java/review/KeepDep.java', '''package review;

public class KeepDep {
    public String read(int n) {
        return "kept" + n;
    }
}
''')
    # A file that parses in the base and not in the working tree: its declarations and relationships
    # are unknown after the change, never "removed" (they may well still be there).
    write(fixture, 'src/main/java/review/Broken.java', '''package review;

public class Broken {
    public String read() {
        return new KeepDep().read(1);
    }
}
''')
    write(fixture, 'src/main/java/review/BrokenClient.java', '''package review;

public class BrokenClient {
    public String use() {
        return new Broken().read();
    }
}
''')
    # A second package gives the browser acceptance a real scope edit to preserve while the
    # review overlay changes colors and source-inspection behavior. It remains unchanged across
    # the comparison so the package itself is a stable parser fact.
    write(fixture, 'src/main/java/support/Stable.java', '''package support;

public class Stable {
    public String value() {
        return "stable";
    }
}
''')
    git(fixture, 'add', 'src/main/java')
    git(fixture, 'commit', '--quiet', '-m', 'review fixture base')
    base_oid = git(fixture, 'rev-parse', 'HEAD')

    # Keep the base and changed relation visible in the exact changed method; the sibling keeps
    # one original route in the mixed view for a color and selection regression check.
    write(fixture, 'src/main/java/review/Hub.java', '''package review;

public class Hub {
    public String changed() {
        return new NewDep().read();
    }

    public String sibling() {
        return new KeepDep().read(1);
    }
}
''')
    write(fixture, 'src/main/java/review/NewDep.java', '''package review;

public class NewDep {
    public String read() {
        return "new";
    }
}
    ''')
    git(fixture, 'add', 'src/main/java/review/Hub.java', 'src/main/java/review/NewDep.java')
    # A second, unstaged edit to a staged file proves the review captures the working tree rather
    # than only the index. Keep the same parser-visible relationship so it remains one route.
    write(fixture, 'src/main/java/review/Hub.java', '''package review;

public class Hub {
    public String changed() {
        return new NewDep().read() + "-working-tree";
    }

    public String sibling() {
        return new KeepDep().read(1);
    }
}
''')
    (fixture / 'src/main/java/review/OldDep.java').unlink()
    write(fixture, 'src/main/java/review/UntrackedHelper.java', '''package review;

public class UntrackedHelper {
    public String label() {
        return "untracked";
    }
}
''')
    write(fixture, 'src/main/java/review/Broken.java', '''package review;

public class Broken {
    public String read() {
        return  new KeepDep().read(1)
    }
}
''')
    write(fixture, 'review-notes.txt', 'Synthetic reviewer fixture, not Java source.\n')
    return base_oid


def main():
    if not JAR.exists():
        raise SystemExit(f'Missing {JAR}. Run ./gradlew bootJar first.')

    # Fail before creating the fixture or output directory when this runtime forbids loopback
    # sockets. The acceptance harness needs local HTTP and Chromium CDP endpoints.
    port, debug_port, offline_model_port = free_port(), free_port(), free_port()

    OUTPUT.mkdir(parents=True, exist_ok=True)
    run = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix='run-', dir=OUTPUT))
    run.mkdir(parents=True, exist_ok=True)
    fixture_parent = Path(tempfile.mkdtemp(prefix='code-atlas-git-review-'))
    fixture = fixture_parent / 'review-fixture'
    make_fixture(fixture)
    base_oid = git(fixture, 'rev-parse', 'HEAD')
    staged = git(fixture, 'diff', '--cached', '--name-only').splitlines()
    unstaged = git(fixture, 'diff', '--name-only').splitlines()
    deleted = git(fixture, 'ls-files', '--deleted').splitlines()
    untracked = git(fixture, 'ls-files', '--others', '--exclude-standard').splitlines()
    if not ({'src/main/java/review/Hub.java', 'src/main/java/review/NewDep.java'} <= set(staged)):
        raise AssertionError(f'Fixture is missing staged Java changes: {staged}')
    if not ({'src/main/java/review/Hub.java', 'src/main/java/review/OldDep.java'} <= set(unstaged)):
        raise AssertionError(f'Fixture is missing unstaged modification/deletion: {unstaged}')
    if 'src/main/java/review/OldDep.java' not in deleted:
        raise AssertionError(f'Fixture is missing an unstaged deleted source: {deleted}')
    if not ({'src/main/java/review/UntrackedHelper.java', 'review-notes.txt'} <= set(untracked)):
        raise AssertionError(f'Fixture is missing untracked source/non-source files: {untracked}')
    before_hash = tree_hash(fixture)
    index_path = fixture / '.git' / 'index'
    before_index_hash = hashlib.sha256(index_path.read_bytes()).hexdigest()
    print(f'Fixture base: {base_oid}')
    print(f'Fixture worktree: {fixture}')
    print(f'Fixture staged paths: {staged}')
    print(f'Fixture unstaged paths: {unstaged}; deleted paths: {deleted}; untracked paths: {untracked}')

    model_hits = []

    class OfflineModelHandler(BaseHTTPRequestHandler):
        def reject_model_request(self):
            model_hits.append({'method': self.command, 'path': self.path})
            length = int(self.headers.get('Content-Length', '0'))
            if length:
                self.rfile.read(length)
            self.send_response(503)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error":"model calls are forbidden in this acceptance run"}')

        def do_GET(self):
            self.reject_model_request()

        def do_POST(self):
            self.reject_model_request()

        def log_message(self, *_args):
            pass

    model_server = ThreadingHTTPServer(('127.0.0.1', offline_model_port), OfflineModelHandler)
    model_thread = threading.Thread(target=model_server.serve_forever, daemon=True)
    model_thread.start()
    base = f'http://127.0.0.1:{port}'
    debug = f'http://127.0.0.1:{debug_port}'
    processes = []
    try:
        with (run / 'application.log').open('w') as log:
            processes.append(subprocess.Popen(
                [os.environ.get('JAVA', 'java'), '-jar', str(JAR), f'--server.port={port}',
                 f'--codeatlas.data-dir={run / "data"}',
                 f'--codeatlas.model.base-url=http://127.0.0.1:{offline_model_port}/v1',
                 '--codeatlas.model.model-id=offline-unreachable'],
                cwd=ROOT, stdout=log, stderr=subprocess.STDOUT))
        await_url(base + '/api/health')

        chromium = os.environ.get('CHROMIUM', '/snap/bin/chromium')
        with (run / 'chromium.log').open('w') as log:
            processes.append(subprocess.Popen(
                [chromium, '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
                 '--remote-allow-origins=*', f'--remote-debugging-port={debug_port}',
                 f'--user-data-dir={run}/chrome', 'about:blank'],
                stdout=log, stderr=subprocess.STDOUT))
        await_url(debug + '/json/version')

        workspace = api(base, '/api/workspaces', {'path': str(fixture)})
        job = api(base, f"/api/workspaces/{workspace['id']}/analysis-jobs", {})
        state = None
        for _ in range(300):
            state = api(base, f"/api/jobs/{job['id']}")
            if state.get('status') in ('COMPLETED', 'FAILED'):
                break
            time.sleep(.2)
        if not state or state.get('status') != 'COMPLETED':
            raise RuntimeError(f"Workspace analysis failed: {state}; inspect {run / 'application.log'}")
        snapshot = api(base, f"/api/workspaces/{workspace['id']}").get('activeSnapshotId')
        if not snapshot:
            raise RuntimeError(f'Analysis produced no active snapshot; inspect {run}')
        print(f"Workspace {workspace['id']} analyzed as snapshot {snapshot}")

        # The UI owns the comparison request in this test. The Node script must submit the base
        # ref through the Code-map Changes controls instead of pre-seeding a comparison via API.
        result = subprocess.run(
            ['node', str(ROOT / 'scripts/verify-git-review-ui.mjs'), base, debug,
             workspace['id'], snapshot, base_oid, str(fixture), str(run)],
            cwd=ROOT, timeout=900)

        after_hash = tree_hash(fixture)
        after_index_hash = hashlib.sha256(index_path.read_bytes()).hexdigest()
        if after_hash != before_hash:
            raise AssertionError('Git review changed the imported workspace or Git metadata')
        if after_index_hash != before_index_hash:
            raise AssertionError('Git review changed .git/index')
        if model_hits:
            raise AssertionError(f'Unexpected model-provider request(s): {model_hits}')

        report_path = run / 'report.json'
        if report_path.exists():
            report = json.loads(report_path.read_text())
            print(f"Checks: {sum(1 for check in report.get('checks', []) if check.get('pass'))}/"
                  f"{len(report.get('checks', []))}; page errors: {len(report.get('pageErrors', []))}")
        screenshots = sorted(path.name for path in run.glob('*.png'))
        print(f"Screenshots ({len(screenshots)}): {', '.join(screenshots)}")
        print(f'Report and screenshots: {run}')
        print(f'Source tree SHA-256: {before_hash} (unchanged)')
        print(f'Git index SHA-256: {before_index_hash} (unchanged)')
        if result.returncode != 0:
            raise SystemExit(f'Git review browser acceptance failed (exit {result.returncode}). Evidence: {run}')
        print('PASS (Review map): runtime Git fixture, Changes toggle on the Code map, per-tab review mode, collapsible heading, diff viewer, source/index unchanged, no model requests.')
    finally:
        model_server.shutdown()
        model_server.server_close()
        for process in reversed(processes):
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
        shutil.rmtree(fixture_parent, ignore_errors=True)


if __name__ == '__main__':
    main()
