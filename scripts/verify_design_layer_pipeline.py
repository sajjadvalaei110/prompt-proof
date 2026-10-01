#!/usr/bin/env python3
"""Design-layer browser check (ADR 0014): packaged application + Chromium + two fixture copies.

Self-contained like verify_change_edges_pipeline.py: free ports, an isolated data directory and
browser profile, COPIES of test-fixtures/spring-project (workspace A) and test-fixtures/stable-graph-fixture
(workspace B) hashed before and after. scripts/verify-design-layer-ui.mjs then authors design
resources and relations through the UI, applies an AI agent's change set over REST while the map
is open, exports the design brief, and imports it into workspace B to rebuild the same map.

The model base URL points at a closed local port: nothing here needs a provider, so this is never
a live-model verification.

Usage:
    python3 scripts/verify_design_layer_pipeline.py [outputDir]

    CHROMIUM=<path> overrides the browser (default /snap/bin/chromium).
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = [ROOT / 'test-fixtures' / 'spring-project', ROOT / 'test-fixtures' / 'stable-graph-fixture']
OUTPUT = ROOT / 'build' / 'design-layer'
JAR = ROOT / 'build' / 'libs' / 'code-atlas-0.1.0-SNAPSHOT.jar'
JAVA = os.environ.get('JAVA', 'java')


def free_port():
    with socket.socket() as connection:
        connection.bind(('127.0.0.1', 0))
        return connection.getsockname()[1]


def await_url(url):
    for _ in range(150):
        try:
            with urllib.request.urlopen(url, timeout=1):
                return
        except Exception:
            time.sleep(.2)
    raise RuntimeError(f'Service did not start: {url}')


def api(base, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(base + path, data=data, method='GET' if body is None else 'POST',
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read() or b'null')


def hashes(directory):
    return {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(directory.rglob('*')) if path.is_file()}


def analyze(base, path):
    workspace = api(base, '/api/workspaces', {'path': str(path)})
    api(base, f"/api/workspaces/{workspace['id']}/analysis-jobs", {})
    for _ in range(300):
        snapshot = api(base, f"/api/workspaces/{workspace['id']}").get('activeSnapshotId')
        if snapshot:
            return workspace['id'], snapshot
        time.sleep(.2)
    raise SystemExit(f'Analysis of {path} produced no active snapshot')


def main():
    if not JAR.exists():
        raise SystemExit(f'Missing {JAR}. Run ./gradlew bootJar first.')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    run = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix='run-', dir=OUTPUT))
    run.mkdir(parents=True, exist_ok=True)
    # Analyze COPIES: the suite asserts the analyzer never writes to the sources it reads.
    fixture_parent = Path(tempfile.mkdtemp(prefix='code-atlas-design-fixtures-'))
    copies = []
    for source in FIXTURES:
        copy = fixture_parent / source.name
        shutil.copytree(source, copy)
        copies.append(copy)
    before = [hashes(c) for c in copies]

    port, debug_port = free_port(), free_port()
    offline_model_port = free_port()  # Deliberately unreachable: nothing listens here.
    base, debug = f'http://127.0.0.1:{port}', f'http://127.0.0.1:{debug_port}'
    processes = []
    try:
        with (run / 'application.log').open('w') as log:
            processes.append(subprocess.Popen(
                [JAVA, '-jar', str(JAR), f'--server.port={port}', f'--codeatlas.data-dir={run}',
                 f'--codeatlas.model.base-url=http://127.0.0.1:{offline_model_port}/v1',
                 '--codeatlas.model.model-id=offline-unreachable'],
                cwd=ROOT, stdout=log, stderr=subprocess.STDOUT))
        await_url(base + '/api/health')
        with (run / 'chromium.log').open('w') as log:
            processes.append(subprocess.Popen(
                [os.environ.get('CHROMIUM', '/snap/bin/chromium'), '--headless=new', '--no-sandbox',
                 '--disable-dev-shm-usage', '--remote-allow-origins=*',
                 f'--remote-debugging-port={debug_port}', f'--user-data-dir={run}/chrome', 'about:blank'],
                stdout=log, stderr=subprocess.STDOUT))
        await_url(debug + '/json/version')

        workspace_a, snapshot_a = analyze(base, copies[0])
        workspace_b, snapshot_b = analyze(base, copies[1])
        result = subprocess.run(
            ['node', str(ROOT / 'scripts/verify-design-layer-ui.mjs'), base, debug, workspace_a, snapshot_a, workspace_b, snapshot_b, str(run)],
            cwd=ROOT, timeout=900)

        for copy, hashed in zip(copies, before):
            assert hashes(copy) == hashed, f'Fixture {copy.name} changed during source-only analysis'
        screenshots = sorted(p.name for p in run.glob('*.png'))
        print(f"Screenshots ({len(screenshots)}): {', '.join(screenshots)}")
        print(f'Report and screenshots: {run}')
        if result.returncode != 0:
            raise SystemExit(f'design-layer run failed (exit {result.returncode}). Evidence: {run}')
        print('PASS (design-layer): fixture sources unchanged, no model provider reachable, evidence recorded.')
    finally:
        for process in reversed(processes):
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
        shutil.rmtree(fixture_parent, ignore_errors=True)


if __name__ == '__main__':
    main()
