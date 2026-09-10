#!/usr/bin/env python3
"""Packaged application + local mock provider + Chromium. Never a live model verification."""
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'build' / 'hierarchy-smoke'
OUTPUT.mkdir(parents=True, exist_ok=True)
# Each run has an isolated database/profile; no user data or model configuration is changed.
import tempfile
RUN = Path(tempfile.mkdtemp(prefix='run-', dir=OUTPUT))
RELEASE = threading.Event()
CONTEXT_RELEASE = threading.Event()
CONTEXT_RELEASE.set()  # Initial architecture preparation should run immediately.
REQUESTS = []

class MockModel(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == '/hold-context':
            CONTEXT_RELEASE.clear()
        if self.path == '/release-context':
            CONTEXT_RELEASE.set()
        if self.path == '/release':
            RELEASE.set()
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'OK')

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        system, user = [message['content'] for message in request['messages']]
        if system.startswith('Summarize a bounded slice'):
            CONTEXT_RELEASE.wait(timeout=60)
            REQUESTS.append('context-summary')
            content = {'summary': 'Synthetic project brief: the fixture implements order processing. Documented intent requires source verification.'}
        elif system.startswith('Infer concise'):
            if '[ev-types] TARGET CLASSES:' in user:
                user = user.split('[ev-types] TARGET CLASSES:', 1)[1].split('[ev-neighbors]', 1)[0]
            classes = re.findall(r'\{symbolId=([^,}]+), qualified_name=([^,}]+),[^\n]*?kind=CLASS,', user)
            assert classes, 'No classes in complete inventory'
            REQUESTS.append('architecture')
            content = {'classes': [{'symbolId': symbol, 'businessLogic': f'Synthetic architecture draft for {name.split(".")[-1]} in the order workflow.'} for symbol, name in classes]}
        else:
            RELEASE.wait(timeout=60)
            match = re.search(r'TARGET (SYMBOL|RELATIONSHIP): (\S+) (\S+) ([^\n]+)', user)
            assert match, 'Missing target context'
            kind, symbol, _, name = match.groups()
            REQUESTS.append(symbol)
            content = {'shortLabel': 'Synthetic workflow explanation', 'hoverSummary': f'Mock provider response for {name.split(".")[-1]}. This verifies context propagation and display, not model quality.', 'claims': [{'description': 'The supplied context contains the indexed source declaration.', 'basis': 'SOURCE_FACT', 'evidenceIds': ['ev-source']}], 'unknowns': ['Synthetic verification output. Runtime behavior is not verified.'], 'suggestedNextSymbolIds': []}
        payload = json.dumps({'choices': [{'message': {'content': json.dumps(content)}}]}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

def free_port():
    with socket.socket() as connection:
        connection.bind(('127.0.0.1', 0))
        return connection.getsockname()[1]

def await_url(url):
    for _ in range(100):
        try:
            with urllib.request.urlopen(url, timeout=1):
                return
        except Exception:
            time.sleep(.2)
    raise RuntimeError(f'Service did not start: {url}')

def hashes(directory):
    return {str(file): hashlib.sha256(file.read_bytes()).hexdigest() for file in directory.rglob('*') if file.is_file()}

def main():
    fixture = ROOT / 'test-fixtures' / 'spring-project'
    before = hashes(fixture)
    mock = ThreadingHTTPServer(('127.0.0.1', 0), MockModel)
    threading.Thread(target=mock.serve_forever, daemon=True).start()
    model = f'http://127.0.0.1:{mock.server_port}'
    port, debug_port = free_port(), free_port()
    base, debug = f'http://127.0.0.1:{port}', f'http://127.0.0.1:{debug_port}'
    jar = ROOT / 'build/libs/code-atlas-0.1.0-SNAPSHOT.jar'
    processes = []
    try:
        with (RUN / 'application.log').open('w') as log:
            processes.append(subprocess.Popen(['java', '-jar', str(jar), f'--server.port={port}', f'--codeatlas.data-dir={RUN}', f'--codeatlas.model.base-url={model}/v1', '--codeatlas.model.model-id=local-mock-verification', '--codeatlas.model.context-budget=100000', '--codeatlas.model.output-budget=4096'], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT))
        await_url(base + '/api/health')
        with (RUN / 'chromium.log').open('w') as log:
            processes.append(subprocess.Popen([os.environ.get('CHROMIUM', '/snap/bin/chromium'), '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-allow-origins=*', f'--remote-debugging-port={debug_port}', f'--user-data-dir={RUN}/chrome', 'about:blank'], stdout=log, stderr=subprocess.STDOUT))
        await_url(debug + '/json/version')
        config = RUN / 'config.json'
        config.write_text(json.dumps({'base': base, 'debug': debug, 'model': model, 'fixture': str(fixture), 'output': str(RUN)}))
        subprocess.run(['node', str(ROOT / 'scripts/verify-hierarchical-ui.mjs'), str(config)], cwd=ROOT, check=True, timeout=180)
        result = json.loads((RUN / 'run.json').read_text())
        with sqlite3.connect(RUN / 'codeatlas.db') as db:
            snapshot = result['snapshot']
            expected = [row[0] for row in db.execute('SELECT subject_id FROM explanation_queue WHERE snapshot_id = ? AND subject_type = \'symbol\' ORDER BY relation_count, loc, subject_id', (snapshot,))]
            first_symbol = REQUESTS.index(expected[0])
            assert set(REQUESTS[:first_symbol]) <= {'context-summary', 'architecture'}
            assert 'context-summary' in REQUESTS[:first_symbol] and 'architecture' in REQUESTS[:first_symbol]
            assert REQUESTS[first_symbol:first_symbol+len(expected)] == expected, 'Model request order differs from degree/LOC order'
            assert len(expected) == result['symbolCount']
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert not db.execute('PRAGMA foreign_key_check').fetchall()
        assert hashes(fixture) == before, 'Fixture changed during source-only analysis'
        print(f'PASS: {len(expected)} bulk symbols, synthesis-first request order, SQLite integrity, source read-only. Mock provider only.')
        print(f'Screenshots: {RUN}')
    finally:
        RELEASE.set()
        CONTEXT_RELEASE.set()
        for process in reversed(processes):
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
        mock.shutdown()

if __name__ == '__main__':
    main()
