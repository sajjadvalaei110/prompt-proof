#!/usr/bin/env python3
"""Verify the packaged filtering/settings surface without touching user state.

This is a deterministic browserless check.  The model connection assertion uses a
local HTTP server that always returns 401; it must never contact a public provider.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler

from verification_support import (
    hashes,
    http_get,
    http_post,
    start_loopback_server,
    stop_loopback_server,
    wait_for_application,
)

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_SOURCE = ROOT / "test-fixtures" / "spring-project"
JAR = ROOT / "build" / "libs" / "code-atlas-0.1.0-SNAPSHOT.jar"
OUTPUT = ROOT / "build" / "filtering-zoom-settings"

def log(msg):
    print(f"[VERIFY] {msg}", flush=True)

class RejectingModel(BaseHTTPRequestHandler):
    """A local provider stub proving the bearer token is sent without network egress."""

    requests = 0

    def do_POST(self):
        type(self).requests += 1
        length = int(self.headers.get("Content-Length", "0"))
        if length:
            self.rfile.read(length)
        self.send_response(401)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"error":"deterministic verification rejection"}')

    def log_message(self, *_args):
        pass

def main():
    log("=== Starting Verification: Filtering, Zoom, and OpenAI Settings ===")

    if not JAR.exists():
        raise SystemExit(f"Missing {JAR}. Run ./gradlew bootJar first.")
    if not FIXTURE_SOURCE.is_dir():
        raise SystemExit(f"Missing fixture {FIXTURE_SOURCE}")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    run = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="run-", dir=OUTPUT))
    run.mkdir(parents=True, exist_ok=True)
    fixture_parent = Path(tempfile.mkdtemp(prefix="code-atlas-filtering-fixture-"))
    fixture = fixture_parent / "spring-project"
    shutil.copytree(FIXTURE_SOURCE, fixture)
    before = hashes(fixture)
    model = None
    model_thread = None
    proc = None
    app_log = None
    try:
        model, model_thread = start_loopback_server(RejectingModel)
        model_url = f"http://127.0.0.1:{model.server_port}/v1"

        # 1. Start an isolated server process.  Keep logs on disk so a noisy app cannot
        # deadlock on a filled PIPE and so credentials never enter this process's stdout.
        log("Starting Spring Boot application from packaged bootJar...")
        app_log_path = run / "application.log"
        app_log = app_log_path.open("w", encoding="utf-8")
        proc = subprocess.Popen(
            [os.environ.get("JAVA", "java"), "-jar", str(JAR),
             "--server.port=0", f"--codeatlas.data-dir={run / 'data'}",
             f"--codeatlas.model.base-url={model_url}",
             "--codeatlas.model.model-id=local-rejecting-verification"],
            cwd=ROOT, stdout=app_log, stderr=subprocess.STDOUT,
        )
        base_url = wait_for_application(proc, app_log_path)
        log(f"Server started successfully on {base_url}")
        
        # 2. Verify UI Bundling of Zoom Controls and Settings Modal
        log("--- Verifying Static UI Bundle for Zoom Controls & Settings Modal ---")
        status, _, html = http_get(base_url, "/")
        assert status == 200
        start = html.find('src="/assets/') + 5
        end = html.find('"', start)
        js_asset = html[start:end]
        status, _, js_code = http_get(base_url, js_asset)
        assert status == 200
        assert "zoom-controls" in js_code, "Expected zoom-controls in compiled JS"
        assert "Model settings" in js_code, "Expected Model settings in compiled JS"
        assert "wheelSensitivity" in js_code, "Expected wheelSensitivity configured in compiled JS"
        assert "minZoom" in js_code, "Expected minZoom configured in compiled JS"
        assert "maxZoom" in js_code, "Expected maxZoom configured in compiled JS"
        log("PASSED: Frontend bundle includes zoom toolbar, wheel sensitivity, min/max zoom, and settings modal.")

        # 3. Verify Model Profile GET / POST / TEST
        log("--- Verifying Model Profile API ---")
        status, _, body = http_get(base_url, "/api/model-profiles")
        assert status == 200
        profiles = json.loads(body)
        assert len(profiles) >= 1
        log(f"Active default profile: {profiles[0]}")

        # Update profile with OpenAI settings
        log("Updating profile with local verification configuration...")
        update_data = {
            "baseUrl": model_url,
            "modelId": "local-rejecting-verification",
            "apiKey": "local-verification-token",
            "contextBudget": 8192,
            "outputBudget": 2048,
            "timeoutSeconds": 30,
            "temperature": 0.2
        }
        status, _, resp_body = http_post(base_url, "/api/model-profiles", update_data)
        assert status == 200
        updated = json.loads(resp_body)
        assert updated["baseUrl"] == model_url
        assert updated["modelId"] == "local-rejecting-verification"
        assert updated["hasApiKey"] is True
        assert updated["temperature"] == 0.2
        log("PASSED: POST /api/model-profiles saved configuration in memory")

        # Verify GET /api/model-profiles masks apiKey
        status, _, resp_body = http_get(base_url, "/api/model-profiles")
        assert status == 200
        get_profile = json.loads(resp_body)[0]
        assert get_profile["hasApiKey"] is True
        assert "local-verification-token" not in resp_body, "CRITICAL: Plain text apiKey leaked in GET response!"
        log("PASSED: GET /api/model-profiles returns hasApiKey=True without leaking raw token")

        # Test Connection endpoint
        log("Testing connection endpoint (POST /api/model-profiles/test)...")
        status, _, test_resp_body = http_post(base_url, "/api/model-profiles/test", {})
        assert status == 200
        test_result = json.loads(test_resp_body)
        assert test_result["actualModelId"] == "local-rejecting-verification"
        assert test_result["latencyMs"] > 0
        # The local stub returns 401 deterministically. This proves the configured endpoint was
        # contacted while keeping the check offline and independent of provider behavior.
        assert any("401" in cap for cap in test_result["capabilities"]) or test_result["chatWorking"], \
            f"Unexpected capabilities: {test_result['capabilities']}"
        assert RejectingModel.requests >= 1, "Expected the local rejecting provider to receive a request"
        log(f"PASSED: POST /api/model-profiles/test reached the local rejecting provider: {test_result['capabilities']}")

        # 4. Verify Analysis and Graph Structure with Compound Hierarchy
        log("--- Verifying Workspace Analysis & Compound Graph Structure ---")
        fixture_path = str(fixture)
        status, _, ws_body = http_post(base_url, "/api/workspaces", {"path": fixture_path, "language": "java"})
        assert status == 200
        ws = json.loads(ws_body)
        ws_id = ws["id"]
        log(f"Created workspace {ws_id}")

        status, _, job_body = http_post(base_url, f"/api/workspaces/{ws_id}/analysis-jobs", {})
        assert status == 200
        job_id = json.loads(job_body)["id"]
        log(f"Triggered analysis job {job_id}")

        for _ in range(20):
            time.sleep(0.5)
            status, _, j_body = http_get(base_url, f"/api/jobs/{job_id}")
            j = json.loads(j_body)
            if j["status"] in ("COMPLETED", "FAILED"):
                break

        assert j["status"] == "COMPLETED", f"Analysis job status: {j['status']}"
        log("Analysis completed successfully")

        # Fetch workspace to get active snapshot
        status, _, ws_updated_body = http_get(base_url, f"/api/workspaces/{ws_id}")
        snap_id = json.loads(ws_updated_body)["activeSnapshotId"]
        assert snap_id is not None

        # Fetch graph
        status, _, graph_body = http_get(base_url, f"/api/snapshots/{snap_id}/graph")
        assert status == 200
        graph = json.loads(graph_body)
        nodes = graph["nodes"]
        edges = graph["edges"]
        log(f"Retrieved graph: {len(nodes)} nodes, {len(edges)} edges")

        # Verify compound relationships: PACKAGE nodes contain CLASS nodes, which contain METHOD nodes
        packages = [n for n in nodes if n.get("kind") == "PACKAGE"]
        classes = [n for n in nodes if n.get("kind") in ("CLASS", "INTERFACE")]
        methods = [n for n in nodes if n.get("kind") == "METHOD"]
        controllers = [n for n in nodes if "REST_CONTROLLER" in (n.get("roles") or [])]

        assert len(packages) > 0, "Expected package nodes"
        assert len(classes) > 0, "Expected class nodes"
        assert len(methods) > 0, "Expected method nodes"
        assert len(controllers) > 0, "Expected REST_CONTROLLER nodes"

        # Verify parent pointers exist
        classes_with_parent = [c for c in classes if c.get("parentId") is not None]
        assert len(classes_with_parent) > 0, "Expected classes to have parentId pointing to packages"
        log(f"PASSED: Graph contains {len(packages)} packages, {len(classes)} classes, {len(methods)} methods, and {len(controllers)} controllers.")

        assert hashes(fixture) == before, "Fixture changed during source-only analysis"

        log("=== ALL VERIFICATION CHECKS PASSED SUCCESSFULLY! ===")

    finally:
        log("Terminating server process...")
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        if app_log is not None:
            app_log.close()
        if model is not None:
            stop_loopback_server(model, model_thread)
        shutil.rmtree(fixture_parent, ignore_errors=True)
        log("Server process and local model stub stopped.")

if __name__ == "__main__":
    main()
