"""Private OFP render service for the EFB backend: POST dispatch JSON -> application/pdf.

Not published to the host; reachable only on the Docker network shared with the EFB.
"""
import hmac
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ofp_render import pdf_filename, render_pdf

TOKEN = os.environ.get("RENDER_TOKEN", "")
MAX_BODY = 5 * 1024 * 1024
SLOTS = threading.BoundedSemaphore(2)  # WeasyPrint is CPU-heavy; cap concurrent renders


class Handler(BaseHTTPRequestHandler):
    def _fail(self, code, msg):
        body = msg.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._fail(200, "ok")
        self._fail(404, "not found")

    def do_POST(self):
        if self.path != "/render":
            return self._fail(404, "not found")
        if not hmac.compare_digest(self.headers.get("X-Render-Token", ""), TOKEN):
            return self._fail(401, "bad token")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if not 0 < length <= MAX_BODY:
            return self._fail(413, "body size")
        try:
            data = json.loads(self.rfile.read(length))
        except ValueError:
            return self._fail(400, "invalid json")
        if not isinstance(data, dict) or not isinstance(data.get("general"), dict):
            return self._fail(422, "not a SimBrief dispatch")
        if not SLOTS.acquire(timeout=20):
            return self._fail(503, "busy")
        try:
            pdf = render_pdf(data)
        except Exception as e:
            print(f"render failed: {e!r}", file=sys.stderr)
            return self._fail(500, "render failed")
        finally:
            SLOTS.release()
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(len(pdf)))
        self.send_header("Content-Disposition", f'inline; filename="{pdf_filename(data)}"')
        self.end_headers()
        self.wfile.write(pdf)


if __name__ == "__main__":
    if len(TOKEN) < 32:
        sys.exit("RENDER_TOKEN must be set (32+ chars)")
    ThreadingHTTPServer(("0.0.0.0", 8502), Handler).serve_forever()
