#!/usr/bin/env python3
"""Stable-map browser regression: packaged application + Chromium + the 60-class fixture.

Graph exploration must work with no model provider reachable, so this runner points the
model base URL at a closed local port and never starts an explanation job. It is therefore
never a live-model verification, and it is not an explanation verification either.

Usage:
    python3 scripts/verify_stable_graph_pipeline.py [baseline|acceptance]

    baseline    (default) records today's behaviour and asserts the known R6 defects.
    acceptance  asserts the stable-map contract; it is expected to fail until Steps 2-3 land.
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
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_SOURCE = ROOT / 'test-fixtures' / 'stable-graph-fixture'
OUTPUT = ROOT / 'build' / 'stable-graph'
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


def hashes(directory):
    return {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(directory.rglob('*')) if path.is_file()}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'baseline'
    if mode not in ('baseline', 'acceptance'):
        raise SystemExit(f'Unknown mode {mode!r}; use baseline or acceptance')
    if not JAR.exists():
        raise SystemExit(f'Missing {JAR}. Run ./gradlew bootJar first.')
    if not FIXTURE_SOURCE.exists():
        raise SystemExit(f'Missing fixture {FIXTURE_SOURCE}')

    OUTPUT.mkdir(parents=True, exist_ok=True)
    # Isolated database and browser profile; no user workspace or model profile is touched.
    run = Path(tempfile.mkdtemp(prefix=f'{mode}-', dir=OUTPUT))
    fixture_parent = Path(tempfile.mkdtemp(prefix='code-atlas-stable-fixture-'))
    fixture = fixture_parent / 'stable-graph-fixture'
    shutil.copytree(FIXTURE_SOURCE, fixture)
    before = hashes(fixture)

    port, debug_port = free_port(), free_port()
    # Deliberately unreachable: nothing listens here, so any provider call would fail.
    offline_model_port = free_port()
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

        config = run / 'config.json'
        config.write_text(json.dumps({'base': base, 'debug': debug, 'fixture': str(fixture),
                                      'output': str(run), 'mode': mode}))
        result = subprocess.run(['node', str(ROOT / 'scripts/verify-stable-graph-ui.mjs'), str(config)],
                                cwd=ROOT, timeout=900)

        assert hashes(fixture) == before, 'Fixture changed during source-only analysis'
        report_path = run / 'stable-graph-report.json'
        if report_path.exists():
            report = json.loads(report_path.read_text())
            print(f"\nScenarios: {len(report['scenarios'])}  Screenshots: {len(report['screenshots'])}")
            print(f"Fixture: {report['fixture']['typeCount']} types / {report['fixture']['packageCount']} packages")
            for scenario in report['scenarios']:
                print(f"  {scenario['name']}: {json.dumps(scenario['delta'])}")
        print(f'Report and screenshots: {run}')
        if result.returncode != 0:
            raise SystemExit(f'{mode} run failed (exit {result.returncode}). Evidence: {run}')
        print(f'PASS ({mode}): fixture source unchanged, no model provider reachable, evidence recorded.')
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
