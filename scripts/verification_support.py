"""Small shared helpers for the packaged Python verification runners."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request


def start_loopback_server(handler: type[BaseHTTPRequestHandler]):
    """Start a local stub on an OS-assigned port and return its server and thread."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def stop_loopback_server(server: ThreadingHTTPServer, thread: threading.Thread):
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def http_get(base_url: str, path: str):
    return _request(base_url, path)


def http_post(base_url: str, path: str, data=None, headers=None):
    return _request(base_url, path, data=data, headers=headers, method="POST")


def _request(base_url: str, path: str, data=None, headers=None, method="GET"):
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(
        f"{base_url}{path}", data=body, headers=req_headers, method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, response.headers, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read().decode("utf-8")


def hashes(directory: Path):
    return {
        str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def wait_for_application(process: subprocess.Popen, log_path: Path, timeout=30):
    """Find Spring Boot's port-0 Tomcat binding and wait until its health route answers."""
    tomcat_port = re.compile(r"Tomcat started on port (\d+) \(http\)")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Application exited during startup (exit {process.returncode})")
        try:
            log_text = log_path.read_text(encoding="utf-8", errors="replace")
        except FileNotFoundError:
            log_text = ""
        match = tomcat_port.search(log_text)
        if match:
            base_url = f"http://127.0.0.1:{match.group(1)}"
            try:
                status, _, _ = http_get(base_url, "/api/health")
                if status == 200:
                    return base_url
            except (OSError, TimeoutError, urllib.error.URLError):
                pass
        time.sleep(0.2)

    try:
        tail = "\n".join(log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-12:])
    except FileNotFoundError:
        tail = "<application log not created>"
    raise RuntimeError(f"Application did not become healthy within {timeout}s. Recent log:\n{tail}")
