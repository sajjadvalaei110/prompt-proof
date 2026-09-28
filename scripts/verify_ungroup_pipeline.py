#!/usr/bin/env python3
"""Ungroup browser acceptance (step 14, ADR 0011): packaged application + Chromium + microservice-java.

The model base URL points at a closed local port and no explanation job is started, so this is
never a live-model verification. Two copies of test-fixtures/microservice-java are made per run: a
plain one, and a Git one whose working tree adds a method to EventService (so Changes marks the
services package MODIFIED). Both are hashed before and after to prove they were only read.

Usage:
    python3 scripts/verify_ungroup_pipeline.py
Screenshots and report.json land in build/ungroup/run-*/evidence.
"""
import hashlib
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_SOURCE = ROOT / 'test-fixtures' / 'microservice-java'
OUTPUT = ROOT / 'build' / 'ungroup'
JAR = ROOT / 'build' / 'libs' / 'code-atlas-0.1.0-SNAPSHOT.jar'
EVENT_SERVICE = Path('src/main/java/com/kipper/eventsmicroservice/services/EventService.java')


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


def git(fixture, *args):
    env = {**os.environ, 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null'}
    return subprocess.run(['git', '-C', str(fixture), *args], env=env, check=True,
                          capture_output=True, text=True).stdout.strip()


def git_fixture(parent):
    fixture = parent / 'git-microservice'
    shutil.copytree(FIXTURE_SOURCE, fixture)
    git(fixture, 'init', '--quiet', '--initial-branch=ungroup-base')
    git(fixture, 'config', 'user.name', 'Code Atlas Acceptance')
    git(fixture, 'config', 'user.email', 'code-atlas-acceptance@example.invalid')
    git(fixture, 'config', 'commit.gpgsign', 'false')
    git(fixture, 'add', '.')
    git(fixture, 'commit', '--quiet', '-m', 'ungroup fixture base')
    base_oid = git(fixture, 'rev-parse', 'HEAD')
    source = fixture / EVENT_SERVICE
    text = source.read_text()
    closing = text.rstrip().rfind('}')
    source.write_text(text[:closing] + '\n    public int pendingCount() {\n        return 0;\n    }\n}\n')
    return fixture, base_oid


def main():
    if not JAR.exists():
        raise SystemExit(f'Missing {JAR}. Run ./gradlew bootJar first.')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix='run-', dir=OUTPUT))
    evidence = run / 'evidence'
    fixture_parent = Path(tempfile.mkdtemp(prefix='code-atlas-ungroup-fixture-'))
    plain = fixture_parent / 'microservice-java'
    shutil.copytree(FIXTURE_SOURCE, plain)
    repo, base_oid = git_fixture(fixture_parent)
    before = {'plain': hashes(plain), 'git': hashes(repo)}

    port, debug_port, offline_model_port = free_port(), free_port(), free_port()
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
        env = {**os.environ, 'BACKEND': base, 'APP': base, 'DEBUG': debug, 'OUT': str(evidence)}
        result = subprocess.run(['node', str(ROOT / 'scripts/verify-ungroup-ui.mjs'), str(plain), str(repo), base_oid],
                                cwd=ROOT, env=env, timeout=900)
        assert hashes(plain) == before['plain'], 'Plain fixture changed during source-only analysis'
        assert hashes(repo) == before['git'], 'Git fixture changed during source-only analysis'
        print(f'Report and screenshots: {evidence}')
        if result.returncode != 0:
            raise SystemExit(f'ungroup acceptance failed (exit {result.returncode}). Evidence: {evidence}')
        print('PASS: fixtures unchanged, no model provider reachable, evidence recorded.')
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
