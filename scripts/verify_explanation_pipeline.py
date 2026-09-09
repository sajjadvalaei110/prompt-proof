#!/usr/bin/env python3
import json
import os
import subprocess
import time
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:8085"

def log(msg):
    print(f"[VERIFY-EXPLAIN] {msg}", flush=True)

def http_get(path):
    url = f"{BASE_URL}{path}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.headers, resp.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode('utf-8')

def http_post(path, data=None, headers=None):
    url = f"{BASE_URL}{path}"
    req_headers = {'Content-Type': 'application/json'}
    if headers:
        req_headers.update(headers)
    body = json.dumps(data).encode('utf-8') if data is not None else b""
    req = urllib.request.Request(url, data=body, headers=req_headers, method='POST')
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.headers, resp.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode('utf-8')

def main():
    log("=== Starting End-to-End LLM Explanation Pipeline Verification ===")
    
    jar_path = "build/libs/code-atlas-0.1.0-SNAPSHOT.jar"
    assert os.path.exists(jar_path), f"Jar file not found at {jar_path}"
    
    log(f"Launching application from {jar_path}...")
    proc = subprocess.Popen(["java", "-jar", jar_path], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    
    try:
        started = False
        for i in range(30):
            try:
                status, _, body = http_get("/api/health")
                if status == 200:
                    started = True
                    break
            except Exception:
                pass
            time.sleep(1)
            
        assert started, "Server did not become healthy within 30 seconds"
        log("Server healthy on http://127.0.0.1:8085")
        
        # 1. Test LLM Profile Connection
        log("Testing model connection via POST /api/model-profiles/test...")
        profile_req = {
            "baseUrl": "https://agentrouter.org/v1",
            "modelId": "deepseek-v4-flash",
            "apiKey": os.environ.get("CODEATLAS_MODEL_API_KEY", ""),
            "contextBudget": 8192,
            "outputBudget": 2048,
            "timeoutSeconds": 60,
            "concurrency": 1,
            "temperature": 0.1,
            # ModelClientService no longer sends a spoofed client identity by default (R6);
            # some providers require their own User-Agent to pass WAF checks, so it's configurable here.
            "userAgent": os.environ.get("CODEATLAS_USER_AGENT", "")
        }
        status, _, body = http_post("/api/model-profiles", profile_req)
        assert status == 200, f"Failed to save profile: {body}"
        
        status, _, body = http_post("/api/model-profiles/test", profile_req)
        assert status == 200, f"Failed to test profile: {body}"
        test_res = json.loads(body)
        log(f"Model test result: chatWorking={test_res.get('chatWorking')}, reachable={test_res.get('reachable')}, latency={test_res.get('latencyMs')}ms")
        assert test_res.get('chatWorking') is True, f"Model connection test failed: {test_res}"
        log("Model connection verified successfully with AgentRouter and deepseek-v4-flash!")
        
        # 2. Ingest Workspace
        fixture_path = os.path.abspath("test-fixtures/spring-project")
        log(f"Ingesting workspace at {fixture_path}...")
        status, _, body = http_post("/api/workspaces", {"path": fixture_path})
        assert status == 200, f"Failed to create workspace: {body}"
        ws = json.loads(body)
        workspace_id = ws["id"]
        log(f"Workspace created: {workspace_id}")
        
        status, _, body = http_post(f"/api/workspaces/{workspace_id}/analysis-jobs", {})
        assert status == 200, f"Failed to trigger analysis: {body}"
        job = json.loads(body)
        job_id = job["id"]
        
        for _ in range(30):
            time.sleep(1)
            status, _, body = http_get(f"/api/jobs/{job_id}")
            job_cur = json.loads(body)
            if job_cur.get("status") in ("COMPLETED", "FAILED"):
                break
                
        assert job_cur.get("status") == "COMPLETED", f"Analysis did not complete: {job_cur}"
        log("Workspace analysis completed!")
        
        status, _, body = http_get(f"/api/workspaces/{workspace_id}")
        ws_updated = json.loads(body)
        snapshot_id = ws_updated.get("activeSnapshotId")
        assert snapshot_id, "Missing active snapshot ID"
        log(f"Active snapshot: {snapshot_id}")
        
        # 3. Find OrderController Symbol
        status, _, body = http_get(f"/api/snapshots/{snapshot_id}/graph")
        assert status == 200, f"Failed to get graph: {body}"
        graph = json.loads(body)
        nodes = graph.get("nodes", [])
        order_controller = next((n for n in nodes if "OrderController" in n.get("simpleName", "")), None)
        assert order_controller, "OrderController node not found in graph"
        symbol_id = order_controller["id"]
        log(f"Found target symbol: {order_controller['simpleName']} (id: {symbol_id})")
        
        # 4. Check initial explanation endpoint (should return NOT_REQUESTED)
        status, _, body = http_get(f"/api/snapshots/{snapshot_id}/symbols/{symbol_id}/explanation")
        assert status == 200, f"GET explanation returned {status}: {body}"
        expl_initial = json.loads(body)
        log(f"Initial explanation status: {expl_initial.get('status')}")
        assert expl_initial.get("status") == "NOT_REQUESTED", f"Expected NOT_REQUESTED, got {expl_initial.get('status')}"
        
        # 5. Request Explanation (High Priority)
        log("Requesting priority explanation for OrderController...")
        status, _, body = http_post(f"/api/explanations/request?workspaceId={workspace_id}&snapshotId={snapshot_id}&subjectId={symbol_id}&subjectType=symbol")
        assert status == 200, f"Request explanation failed: {body}"
        log("Explanation request queued!")
        
        # 6. Poll until READY
        ready = False
        expl_final = None
        for i in range(45):
            time.sleep(1)
            status, _, body = http_get(f"/api/snapshots/{snapshot_id}/symbols/{symbol_id}/explanation")
            if status == 200:
                expl = json.loads(body)
                curr_status = expl.get("status")
                log(f"Poll {i+1}s: status = {curr_status}")
                if curr_status == "READY":
                    ready = True
                    expl_final = expl
                    break
                elif curr_status == "FAILED":
                    log(f"Explanation failed: {expl}")
                    break
                    
        assert ready, f"Explanation was not READY within 45s: {expl_final}"
        log("=== EXPLANATION GENERATED SUCCESSFULLY ===")
        log(f"Short Label: {expl_final.get('shortLabel')}")
        log(f"Hover Summary: {expl_final.get('hoverSummary')}")
        log(f"Claims ({len(expl_final.get('claims', []))}):")
        for idx, c in enumerate(expl_final.get('claims', [])):
            log(f"  [{idx+1}] ({c.get('basis')}) {c.get('description')} -> evidence: {c.get('evidenceIds')}")
        log(f"Unknowns: {expl_final.get('unknowns')}")
        log(f"Provenance: {expl_final.get('provenance')}")
        
        assert expl_final.get("shortLabel"), "Missing shortLabel"
        assert expl_final.get("hoverSummary"), "Missing hoverSummary"
        assert len(expl_final.get("claims", [])) > 0, "Expected at least 1 claim"
        assert expl_final.get("provenance"), "Missing provenance"
        
        # 7. Headless Browser UI Verification
        log("Capturing headless browser UI screenshot to verify Inspector Panel...")
        screenshot_path = "explanation_inspector_preview.png"
        ui_url = f"http://127.0.0.1:8085/?snapshotId={snapshot_id}&selectedSymbol=OrderController"
        chrome_cmd = [
            "/snap/bin/chromium",
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--window-size=1400,900",
            "--virtual-time-budget=5000",
            f"--screenshot={screenshot_path}",
            ui_url
        ]
        log(f"Running: {' '.join(chrome_cmd)}")
        subprocess.run(chrome_cmd, timeout=30)
        assert os.path.exists(screenshot_path), "Screenshot file was not generated"
        log(f"Screenshot successfully saved to {screenshot_path}")
        
        log("=== All End-to-End Checks Passed! ===")
        
    finally:
        log("Terminating server process...")
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log("Server stopped.")

if __name__ == "__main__":
    main()
