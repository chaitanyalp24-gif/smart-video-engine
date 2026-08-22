"""
Smart Video Engine - Local Dev Server with COOP/COEP Headers & Image Proxy
========================================================================
"""

import http.server
import socketserver
import os
import time
import urllib.parse
import urllib.request
import sys

PORT = int(os.environ.get("PORT", 8080))
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

_no_proxy_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js":   "text/javascript; charset=utf-8",
    ".mjs":  "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".css":  "text/css; charset=utf-8",
    ".map":  "application/json; charset=utf-8",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".wav":  "audio/wav",
    ".mp4":  "video/mp4",
    ".svg":  "image/svg+xml",
}


class SmartVideoServerHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = http.server.SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map.update({
        ".html": "text/html; charset=utf-8",
        ".js":   "text/javascript; charset=utf-8",
        ".mjs":  "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".wasm": "application/wasm",
        ".css":  "text/css; charset=utf-8",
        ".map":  "application/json; charset=utf-8",
        ".png":  "image/png",
        ".jpg":  "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".wav":  "audio/wav",
        ".mp4":  "video/mp4",
        ".svg":  "image/svg+xml",
        "":      "application/octet-stream",
    })

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/proxy-image":
            query = urllib.parse.parse_qs(parsed.query)
            target_url = query.get("url", [None])[0]
            if not target_url:
                self.send_error(400, "Missing 'url' parameter")
                return

            # Retry up to 3 times for robustness
            for attempt in range(3):
                try:
                    req = urllib.request.Request(target_url, headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                    })
                    with _no_proxy_opener.open(req, timeout=90) as resp:
                        data = resp.read()
                        content_type = resp.headers.get("Content-Type", "image/jpeg")

                        if len(data) > 0:
                            self.send_response(200)
                            self.send_header("Content-Type", content_type)
                            self.send_header("Content-Length", str(len(data)))
                            self.send_header("Cache-Control", "public, max-age=86400")
                            self.end_headers()
                            self.wfile.write(data)
                            return
                except Exception as e:
                    print(f"  [proxy] Attempt {attempt+1} failed: {e}")
                    time.sleep(1)

            # If all retries fail, return a 1x1 dark pixel or error
            self.send_error(502, "Failed to retrieve image after retries")
            return

        if parsed.path in ["", "/", "/index.html"]:
            self.send_response(302)
            self.send_header("Location", "/demo/index.html")
            self.end_headers()
            return

        super().do_GET()

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return MIME_TYPES.get(ext, "application/octet-stream")

    def log_message(self, format, *args):
        pass


class ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def run():
    with ThreadingServer(("", PORT), SmartVideoServerHandler) as httpd:
        print(f"\n========================================================")
        print(f"  Smart Video Engine Demo Server (threaded)")
        print(f"  Root:    {ROOT}")
        print(f"  URL:     http://localhost:{PORT}/demo/index.html")
        print(f"========================================================\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    run()
