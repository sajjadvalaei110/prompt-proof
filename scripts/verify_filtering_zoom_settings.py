#!/usr/bin/env python3
import json
import os
import subprocess
import time
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:8085"

def log(msg):
    print(f"[VERIFY] {msg}", flush=True)

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
    log("=== Starting Verification: Filtering, Zoom, and OpenAI Settings ===")
    
    # 1. Start server process
    log("Starting Spring Boot application from packaged bootJar...")
    jar_path = "build/libs/code-atlas-0.1.0-SNAPSHOT.jar"
    proc = subprocess.Popen(["java", "-jar", jar_path], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    
    try:
        # Wait for startup
        started = False
        for _ in range(30):
            try:
                status, _, body = http_get("/api/health")
                if status == 200:
                    started = True
                    break
            except Exception:
                pass
            time.sleep(1)
            
        assert started, "Failed to start application within 30 seconds"
        log("Server started successfully on http://127.0.0.1:8085")
        
        # 2. Verify UI Bundling of Zoom Controls and Settings Modal
        log("--- Verifying Static UI Bundle for Zoom Controls & Settings Modal ---")
        status, _, html = http_get("/")
        assert status == 200
        start = html.find('src="/assets/') + 5
        end = html.find('"', start)
        js_asset = html[start:end]
        status, _, js_code = http_get(js_asset)
        assert status == 200
        assert "graph-zoom-toolbar" in js_code, "Expected graph-zoom-toolbar in compiled JS"
        assert "Model & LLM Settings" in js_code, "Expected Model & LLM Settings in compiled JS"
        assert "wheelSensitivity" in js_code, "Expected wheelSensitivity configured in compiled JS"
        assert "minZoom" in js_code, "Expected minZoom configured in compiled JS"
        assert "maxZoom" in js_code, "Expected maxZoom configured in compiled JS"
        log("PASSED: Frontend bundle includes zoom toolbar, wheel sensitivity, min/max zoom, and settings modal.")

        # 3. Verify Model Profile GET / POST / TEST
        log("--- Verifying Model Profile API ---")
        status, _, body = http_get("/api/model-profiles")
        assert status == 200
        profiles = json.loads(body)
        assert len(profiles) >= 1
        log(f"Active default profile: {profiles[0]}")

        # Update profile with OpenAI settings
        log("Updating profile with OpenAI configuration...")
        update_data = {
            "baseUrl": "https://api.openai.com/v1",
            "modelId": "gpt-4o",
            "apiKey": "sk-verify-test-key-9999",
            "contextBudget": 8192,
            "outputBudget": 2048,
            "timeoutSeconds": 30,
            "temperature": 0.2
        }
        status, _, resp_body = http_post("/api/model-profiles", update_data)
        assert status == 200
        updated = json.loads(resp_body)
        assert updated["baseUrl"] == "https://api.openai.com/v1"
        assert updated["modelId"] == "gpt-4o"
        assert updated["hasApiKey"] is True
        assert updated["temperature"] == 0.2
        log("PASSED: POST /api/model-profiles saved configuration in memory")

        # Verify GET /api/model-profiles masks apiKey
        status, _, resp_body = http_get("/api/model-profiles")
        assert status == 200
        get_profile = json.loads(resp_body)[0]
        assert get_profile["hasApiKey"] is True
        assert "sk-verify-test-key-9999" not in resp_body, "CRITICAL: Plain text apiKey leaked in GET response!"
        log("PASSED: GET /api/model-profiles returns hasApiKey=True without leaking raw token")

        # Test Connection endpoint
        log("Testing connection endpoint (POST /api/model-profiles/test)...")
        status, _, test_resp_body = http_post("/api/model-profiles/test", {})
        assert status == 200
        test_result = json.loads(test_resp_body)
        assert test_result["actualModelId"] == "gpt-4o"
        assert test_result["latencyMs"] > 0
        # OpenAI returns 401 Unauthorized for fake key, which confirms the Bearer token was sent
        assert any("401" in cap for cap in test_result["capabilities"]) or test_result["chatWorking"], \
            f"Unexpected capabilities: {test_result['capabilities']}"
        log(f"PASSED: POST /api/model-profiles/test communicated with OpenAI endpoint and reported status: {test_result['capabilities']}")

        # 4. Verify Analysis and Graph Structure with Compound Hierarchy
        log("--- Verifying Workspace Analysis & Compound Graph Structure ---")
        fixture_path = os.path.abspath("test-fixtures/spring-project")
        status, _, ws_body = http_post("/api/workspaces", {"path": fixture_path})
        assert status == 200
        ws = json.loads(ws_body)
        ws_id = ws["id"]
        log(f"Created workspace {ws_id}")

        status, _, job_body = http_post(f"/api/workspaces/{ws_id}/analysis-jobs", {})
        assert status == 200
        job_id = json.loads(job_body)["id"]
        log(f"Triggered analysis job {job_id}")

        for _ in range(20):
            time.sleep(0.5)
            status, _, j_body = http_get(f"/api/jobs/{job_id}")
            j = json.loads(j_body)
            if j["status"] in ("COMPLETED", "FAILED"):
                break

        assert j["status"] == "COMPLETED", f"Analysis job status: {j['status']}"
        log("Analysis completed successfully")

        # Fetch workspace to get active snapshot
        status, _, ws_updated_body = http_get(f"/api/workspaces/{ws_id}")
        snap_id = json.loads(ws_updated_body)["activeSnapshotId"]
        assert snap_id is not None

        # Fetch graph
        status, _, graph_body = http_get(f"/api/snapshots/{snap_id}/graph")
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

        log("=== ALL VERIFICATION CHECKS PASSED SUCCESSFULLY! ===")

    finally:
        log("Terminating server process...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        log("Server process terminated.")

if __name__ == "__main__":
    main()
