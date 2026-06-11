from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
import json
import re
import threading
import time
import sys


HOST = "localhost"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
TTL_SECONDS = 24 * 60 * 60
NUSMODS_BASE = "https://api.nusmods.com/v2"
CACHE_DIR = Path(".cache") / "nusmods"
cache_locks = {}
cache_locks_guard = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/nusmods/status":
            self.send_json({"enabled": True, "cacheTtlSeconds": TTL_SECONDS})
            return

        if parsed.path == "/api/nusmods/module-list":
            params = parse_qs(parsed.query)
            year = first(params, "year")
            if not valid_year(year):
                self.send_json({"error": "Invalid academic year"}, status=400)
                return

            self.send_cached(
                CACHE_DIR / year / "moduleList.json",
                f"{NUSMODS_BASE}/{year}/moduleList.json",
            )
            return

        if parsed.path == "/api/nusmods/module-info":
            params = parse_qs(parsed.query)
            year = first(params, "year")
            code = first(params, "code").upper()
            if not valid_year(year) or not valid_module_code(code):
                self.send_json({"error": "Invalid module request"}, status=400)
                return

            self.send_cached(
                CACHE_DIR / year / "modules" / f"{code}.json",
                f"{NUSMODS_BASE}/{year}/modules/{code}.json",
            )
            return

        super().do_GET()

    def send_cached(self, cache_path, upstream_url):
        try:
            self.send_json(cached_json(cache_path, upstream_url))
        except (HTTPError, URLError, TimeoutError):
            self.send_json({"error": "NUSMods API unavailable and no cached response exists"}, status=502)

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "public, max-age=300")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def first(params, key):
    return params.get(key, [""])[0]


def valid_year(year):
    return re.fullmatch(r"\d{4}-\d{4}", year or "") is not None


def valid_module_code(code):
    return re.fullmatch(r"[A-Z0-9]{2,12}", code or "") is not None


def cached_json(path, upstream_url):
    lock = lock_for(path)
    with lock:
        if path.exists() and time.time() - path.stat().st_mtime < TTL_SECONDS:
            return json.loads(path.read_text(encoding="utf-8"))

        try:
            request = Request(upstream_url, headers={"User-Agent": "gpa-calculator-cache/1.0"})
            with urlopen(request, timeout=15) as response:
                data = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError):
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8"))
            raise

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")
        return data


def lock_for(path):
    key = str(path)
    with cache_locks_guard:
        if key not in cache_locks:
            cache_locks[key] = threading.Lock()
        return cache_locks[key]


if __name__ == "__main__":
    print(f"Serving GPA calculator at http://{HOST}:{PORT}")
    print("NUSMods responses are cached server-side for 24 hours.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
