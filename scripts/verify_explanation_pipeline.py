#!/usr/bin/env python3
"""Packaged explanation acceptance with explicit live and local-mock modes.

Live mode requires the caller to supply the endpoint and model.  Mock mode is
explicit (``--mock`` or ``CODEATLAS_EXPLANATION_MODE=mock``) and serves an
OpenAI-compatible response from a loopback-only stub.  There is no public-provider
default, and mock runs never claim live model quality.  The source fixture and
application data live in disposable directories.
"""
import json
import os
from http.server import BaseHTTPRequestHandler
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

from verification_support import hashes, http_get, http_post, start_loopback_server, stop_loopback_server, wait_for_application

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_SOURCE = ROOT / "test-fixtures" / "spring-project"
JAR = ROOT / "build" / "libs" / "code-atlas-0.1.0-SNAPSHOT.jar"
LIVE_OUTPUT = ROOT / "build" / "explanation-live"
MOCK_OUTPUT = ROOT / "build" / "explanation-mock"

def log(msg):
    print(f"[VERIFY-EXPLAIN] {msg}", flush=True)

class LocalMockModel(BaseHTTPRequestHandler):
    """Deterministic OpenAI-compatible provider used only by explicit mock mode."""

    requests = 0
    target_ids = []

    def do_POST(self):
        type(self).requests += 1
        length = int(self.headers.get("Content-Length", "0"))
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, TypeError):
            self.send_error(400, "invalid JSON")
            return

        messages = request.get("messages") or []
        if len(messages) == 1:
            # ModelClientService.testConnection only requires a successful
            # OpenAI-compatible response; the text is intentionally generic.
            content = "OK"
        else:
            user = str(messages[-1].get("content", ""))
            target = re.search(r"TARGET (?:SYMBOL|RELATIONSHIP):\s+(\S+)", user)
            target_id = target.group(1) if target else "fixture-target"
            type(self).target_ids.append(target_id)
            # ContextBuilder always supplies ev-source for a valid subject.  This
            # response therefore exercises the same evidence validation path as a
            # model response while remaining independent of source-derived prose.
            content = json.dumps({
                "shortLabel": "Synthetic explanation",
                "hoverSummary": "A deterministic local provider response for transport and schema verification.",
                "claims": [{
                    "description": f"The indexed declaration for {target_id} is available in the supplied source context.",
                    "basis": "SOURCE_FACT",
                    "evidenceIds": ["ev-source"],
                }],
                "unknowns": ["Runtime behavior is not established by this local mock."],
                "suggestedNextSymbolIds": [],
            })
        payload = json.dumps({"choices": [{"message": {"content": content}}]}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        pass

def main():
    log("=== Starting End-to-End LLM Explanation Pipeline Verification ===")

    arguments = sys.argv[1:]
    mock_mode = "--mock" in arguments or os.environ.get("CODEATLAS_EXPLANATION_MODE", "live").strip().lower() == "mock"
    output_argument = next((argument for argument in arguments if argument != "--mock"), None)
    model_server = None
    model_thread = None
    if mock_mode:
        model_id = "local-mock-explanation-verification"
        output_root = MOCK_OUTPUT
        log("Using the explicit local mock provider; this run verifies transport, schema, provenance, and UI only.")
    else:
        model_base_url = os.environ.get("CODEATLAS_MODEL_BASE_URL", "").strip()
        model_id = os.environ.get("CODEATLAS_MODEL_MODEL_ID", "").strip()
        if not model_base_url or not model_id:
            raise SystemExit(
                "Live explanation verification requires CODEATLAS_MODEL_BASE_URL and "
                "CODEATLAS_MODEL_MODEL_ID; use --mock or CODEATLAS_EXPLANATION_MODE=mock "
                "for a deterministic loopback-only check."
            )
        output_root = LIVE_OUTPUT
        log("Using the caller-configured model endpoint; this run is the live-model check.")
    if not JAR.exists():
        raise SystemExit(f"Jar file not found at {JAR}. Run ./gradlew bootJar first.")
    if not FIXTURE_SOURCE.is_dir():
        raise SystemExit(f"Missing fixture {FIXTURE_SOURCE}")

    output_root.mkdir(parents=True, exist_ok=True)
    run = Path(output_argument).resolve() if output_argument else Path(tempfile.mkdtemp(prefix="run-", dir=output_root))
    run.mkdir(parents=True, exist_ok=True)
    fixture_parent = Path(tempfile.mkdtemp(prefix="code-atlas-explanation-fixture-"))
    fixture = fixture_parent / "spring-project"
    shutil.copytree(FIXTURE_SOURCE, fixture)
    before = hashes(fixture)
    proc = None
    model_server = None
    model_thread = None
    try:
        if mock_mode:
            model_server, model_thread = start_loopback_server(LocalMockModel)
            model_base_url = f"http://127.0.0.1:{model_server.server_port}/v1"

        log(f"Launching application from {JAR}...")
        app_log_path = run / "application.log"
        app_log = app_log_path.open("w", encoding="utf-8")
        child_env = os.environ.copy()
        # The application reads these exact Spring relaxed-binding names.  Passing the
        # values through the child environment avoids exposing an API key in argv output.
        child_env["CODEATLAS_MODEL_BASE_URL"] = model_base_url
        child_env["CODEATLAS_MODEL_MODEL_ID"] = model_id
        if mock_mode:
            # Do not carry a caller's credential into a local-only run.
            child_env.pop("CODEATLAS_MODEL_API_KEY", None)
        proc = subprocess.Popen(
            [os.environ.get("JAVA", "java"), "-jar", str(JAR),
             "--server.port=0", f"--codeatlas.data-dir={run / 'data'}"],
            cwd=ROOT, env=child_env, stdout=app_log, stderr=subprocess.STDOUT,
        )
        base_url = wait_for_application(proc, app_log_path)
        log(f"Server healthy on {base_url}")
        
        # 1. Test LLM Profile Connection
        log("Testing the caller-configured model connection via POST /api/model-profiles/test...")
        status, _, profile_body = http_get(base_url, "/api/model-profiles")
        assert status == 200, f"Failed to read configured model profile: {profile_body}"
        configured_profile = json.loads(profile_body)
        assert configured_profile and configured_profile[0].get("baseUrl") == model_base_url, \
            "Application did not load CODEATLAS_MODEL_BASE_URL"
        assert configured_profile[0].get("modelId") == model_id, \
            "Application did not load CODEATLAS_MODEL_MODEL_ID"

        status, _, body = http_post(base_url, "/api/model-profiles/test", {})
        assert status == 200, f"Failed to test profile: {body}"
        test_res = json.loads(body)
        log(f"Model test result: chatWorking={test_res.get('chatWorking')}, reachable={test_res.get('reachable')}, latency={test_res.get('latencyMs')}ms")
        assert test_res.get('chatWorking') is True, f"Model connection test failed: {test_res}"
        if mock_mode:
            assert LocalMockModel.requests >= 1, "The local mock provider did not receive the profile test request"
            log("Local mock provider connection verified; no live model was contacted.")
        else:
            log("Model connection verified successfully with the configured endpoint.")
        
        # 2. Ingest Workspace
        fixture_path = str(fixture)
        log("Ingesting the disposable Java fixture...")
        status, _, body = http_post(base_url, "/api/workspaces", {"path": fixture_path, "language": "java"})
        assert status == 200, f"Failed to create workspace: {body}"
        ws = json.loads(body)
        workspace_id = ws["id"]
        log(f"Workspace created: {workspace_id}")
        
        status, _, body = http_post(base_url, f"/api/workspaces/{workspace_id}/analysis-jobs", {})
        assert status == 200, f"Failed to trigger analysis: {body}"
        job = json.loads(body)
        job_id = job["id"]
        
        for _ in range(120):
            time.sleep(1)
            status, _, body = http_get(base_url, f"/api/jobs/{job_id}")
            job_cur = json.loads(body)
            if job_cur.get("status") in ("COMPLETED", "FAILED"):
                break
                
        assert job_cur.get("status") == "COMPLETED", f"Analysis did not complete: {job_cur}"
        log("Workspace analysis completed!")
        
        status, _, body = http_get(base_url, f"/api/workspaces/{workspace_id}")
        ws_updated = json.loads(body)
        snapshot_id = ws_updated.get("activeSnapshotId")
        assert snapshot_id, "Missing active snapshot ID"
        log(f"Active snapshot: {snapshot_id}")
        
        # 3. Find OrderController Symbol
        status, _, body = http_get(base_url, f"/api/snapshots/{snapshot_id}/graph")
        assert status == 200, f"Failed to get graph: {body}"
        graph = json.loads(body)
        nodes = graph.get("nodes", [])
        order_controller = next((n for n in nodes if "OrderController" in n.get("simpleName", "")), None)
        assert order_controller, "OrderController node not found in graph"
        symbol_id = order_controller["id"]
        log(f"Found target symbol: {order_controller['simpleName']} (id: {symbol_id})")
        
        # 4. Check initial explanation endpoint (should return NOT_REQUESTED)
        status, _, body = http_get(base_url, f"/api/snapshots/{snapshot_id}/symbols/{symbol_id}/explanation")
        assert status == 200, f"GET explanation returned {status}: {body}"
        expl_initial = json.loads(body)
        log(f"Initial explanation status: {expl_initial.get('status')}")
        assert expl_initial.get("status") == "NOT_REQUESTED", f"Expected NOT_REQUESTED, got {expl_initial.get('status')}"
        
        # 5. Request Explanation (High Priority)
        log("Requesting priority explanation for OrderController...")
        status, _, body = http_post(base_url, f"/api/explanations/request?workspaceId={workspace_id}&snapshotId={snapshot_id}&subjectId={symbol_id}&subjectType=symbol")
        assert status == 200, f"Request explanation failed: {body}"
        log("Explanation request queued!")
        
        # 6. Poll until READY
        ready = False
        expl_final = None
        for i in range(120):
            time.sleep(1)
            status, _, body = http_get(base_url, f"/api/snapshots/{snapshot_id}/symbols/{symbol_id}/explanation")
            if status == 200:
                expl = json.loads(body)
                curr_status = expl.get("status")
                log(f"Poll {i+1}s: status = {curr_status}")
                if curr_status == "READY":
                    ready = True
                    expl_final = expl
                    break
                elif curr_status == "FAILED":
                    log("Explanation failed; inspect the isolated application log for the provider error.")
                    break
                    
        assert ready, "Explanation was not READY within 120s; inspect the isolated application log."
        if mock_mode:
            log("=== DETERMINISTIC MOCK EXPLANATION GENERATED ===")
        else:
            log("=== LIVE EXPLANATION GENERATED SUCCESSFULLY ===")
        # Keep generated source-derived text and provider metadata out of terminal logs.
        log(f"Explanation payload shape: claims={len(expl_final.get('claims', []))}, "
            f"unknowns={len(expl_final.get('unknowns', []))}, provenance_present={bool(expl_final.get('provenance'))}")
        
        assert expl_final.get("shortLabel"), "Missing shortLabel"
        assert expl_final.get("hoverSummary"), "Missing hoverSummary"
        assert len(expl_final.get("claims", [])) > 0, "Expected at least 1 claim"
        assert expl_final.get("provenance"), "Missing provenance"
        if mock_mode:
            assert LocalMockModel.requests >= 2, "The local mock provider did not receive an explanation request"
            assert symbol_id in LocalMockModel.target_ids, (
                "The local mock did not receive the actual requested symbol ID; "
                f"saw {LocalMockModel.target_ids}"
            )
            assert any(symbol_id in claim.get("description", "") for claim in expl_final.get("claims", [])), (
                "Mock explanation claims did not retain the requested symbol ID"
            )
        
        # 7. Headless Browser UI Verification
        log("Capturing headless browser UI screenshot to verify Inspector Panel...")
        screenshot_path = run / "explanation_inspector_preview.png"
        ui_url = f"{base_url}/?snapshotId={snapshot_id}&selectedSymbol=OrderController"
        chromium = os.environ.get("CHROMIUM", "/snap/bin/chromium")
        chrome_cmd = [
            chromium,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            f"--user-data-dir={run / 'chrome'}",
            "--window-size=1400,900",
            "--virtual-time-budget=5000",
            f"--screenshot={str(screenshot_path)}",
            ui_url
        ]
        log("Capturing the Inspector Panel screenshot with Chromium...")
        screenshot = subprocess.run(chrome_cmd, timeout=30, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        assert screenshot.returncode == 0, f"Chromium screenshot failed (exit {screenshot.returncode})"
        assert screenshot_path.exists(), "Screenshot file was not generated"
        log(f"Screenshot successfully saved to {screenshot_path}")
        assert hashes(fixture) == before, "Fixture changed during source-only analysis"
        
        log("=== All End-to-End Checks Passed! ===")
        
    finally:
        log("Terminating server process...")
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        if 'app_log' in locals():
            app_log.close()
        shutil.rmtree(fixture_parent, ignore_errors=True)
        if model_server is not None:
            stop_loopback_server(model_server, model_thread)
        log("Server stopped.")

if __name__ == "__main__":
    main()
