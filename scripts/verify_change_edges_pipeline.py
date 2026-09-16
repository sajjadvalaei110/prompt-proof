#!/usr/bin/env python3
"""Change-edges browser regression: packaged application + Chromium + the change-edges fixture.

Self-contained, like verify_stable_graph_pipeline.py: it picks its own free ports, starts the jar
against an isolated data directory, starts a headless Chromium, analyzes a COPY of the fixture
through the API, and then runs scripts/verify-change-edges-ui.mjs against that snapshot. Nothing in
the user's workspace, database or browser profile is touched, and the fixture copy is hashed before
and after to prove analysis stayed read-only.

The model base URL points at a closed local port on purpose. This suite checks graph drawing,
directional emphasis and source evidence -- none of which may need a provider -- so a run that
somehow did reach for one would fail loudly instead of quietly depending on it. This is therefore
never a live-model verification.

Usage:
    python3 scripts/verify_change_edges_pipeline.py [outputDir]

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
FIXTURE_SOURCE = ROOT / 'test-fixtures' / 'change-edges-fixture'
OUTPUT = ROOT / 'build' / 'change-edges'
JAR = ROOT / 'build' / 'libs' / 'code-atlas-0.1.0-SNAPSHOT.jar'


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


def main():
    if not JAR.exists():
        raise SystemExit(f'Missing {JAR}. Run ./gradlew bootJar first.')
    if not FIXTURE_SOURCE.exists():
        raise SystemExit(f'Missing fixture {FIXTURE_SOURCE}')

    OUTPUT.mkdir(parents=True, exist_ok=True)
    run = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix='run-', dir=OUTPUT))
    run.mkdir(parents=True, exist_ok=True)
    # Analyze a COPY: the suite asserts the analyzer never writes to the sources it reads.
    fixture_parent = Path(tempfile.mkdtemp(prefix='code-atlas-change-edges-fixture-'))
    fixture = fixture_parent / 'change-edges-fixture'
    shutil.copytree(FIXTURE_SOURCE, fixture)
    before = hashes(fixture)

    port, debug_port = free_port(), free_port()
    offline_model_port = free_port()  # Deliberately unreachable: nothing listens here.
    base, debug = f'http://127.0.0.1:{port}', f'http://127.0.0.1:{debug_port}'
    processes = []
    try:
        with (run / 'application.log').open('w') as log:
            processes.append(subprocess.Popen(
                ['java', '-jar', str(JAR), f'--server.port={port}', f'--codeatlas.data-dir={run}',
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

        workspace = api(base, '/api/workspaces', {'path': str(fixture)})
        api(base, f"/api/workspaces/{workspace['id']}/analysis-jobs", {})
        snapshot = None
        for _ in range(300):
            snapshot = api(base, f"/api/workspaces/{workspace['id']}").get('activeSnapshotId')
            if snapshot:
                break
            time.sleep(.2)
        if not snapshot:
            raise SystemExit(f'Analysis produced no active snapshot. Evidence: {run}')

        result = subprocess.run(
            ['node', str(ROOT / 'scripts/verify-change-edges-ui.mjs'), base, debug, snapshot, str(run)],
            cwd=ROOT, timeout=900)

        assert hashes(fixture) == before, 'Fixture changed during source-only analysis'
        report_path = run / 'report.json'
        if report_path.exists():
            report = json.loads(report_path.read_text())
            print(f"\nLines: {len(report.get('edges', []))}  Page errors: {len(report.get('pageErrors', []))}")
            for edge in report.get('edges', []):
                print(f"  {edge['s']} -> {edge['t']}: {edge['n']} occurrence(s), width {edge['rendered']}, {edge['kinds']}")
        screenshots = sorted(p.name for p in run.glob('*.png'))
        print(f"Screenshots ({len(screenshots)}): {', '.join(screenshots)}")
        print(f'Report and screenshots: {run}')
        if result.returncode != 0:
            raise SystemExit(f'change-edges run failed (exit {result.returncode}). Evidence: {run}')
        print('PASS (change-edges): fixture source unchanged, no model provider reachable, evidence recorded.')
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
