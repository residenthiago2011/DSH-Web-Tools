"""Exa-shaped web search shim backed by DuckDuckGo.

dsh's `@deepseek-ai/dsh-web-search-exa` provider talks a small, stable HTTP
contract and lets you point it anywhere via `baseURL`. This server speaks that
contract and answers from DuckDuckGo, so dsh gets real web search with no API
key, no signup, and no per-query billing.

Contract (from packages/web/web-search-exa/src/provider.ts):

  POST {baseURL}/search
    headers: authorization: Bearer <key>   (any non-empty value; ignored here)
    body:    {query, type, contents: {highlights: {highlightsPerUrl}}, numResults?}
    ->       {results: [{url, title?, highlights: [str], publishedDate?}]}

IMPORTANT: `mapExaResult` DROPS any result whose `highlights` holds no
non-blank string -- the seam has no other field to derive a snippet from. So
every result here must carry a real snippet or it vanishes silently.

The provider sends `redirect: 'error'`, so never redirect. Bind loopback only:
there is no auth on this thing.

To back this with SearXNG or another engine instead of DuckDuckGo, replace
`search()` below -- it is the only backend-specific function. Its contract is
`(query, num_results) -> [{url, title?, highlights: [snippet]}]`.

Run:
    Windows        venv\\Scripts\\python.exe server.py [--port 8899]
    macOS / Linux  venv/bin/python server.py [--port 8899]
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ddgs import DDGS

DEFAULT_PORT = 8899
DEFAULT_RESULTS = 8
MAX_RESULTS = 25
MAX_BODY_BYTES = 64 * 1024

log = logging.getLogger("ddg-shim")


def search(query: str, num_results: int) -> list[dict]:
    """Run a DuckDuckGo text search and map it into Exa's result shape."""
    out: list[dict] = []
    with DDGS() as ddgs:
        for row in ddgs.text(query, max_results=num_results):
            url = row.get("href") or row.get("url") or ""
            snippet = (row.get("body") or "").strip()
            # No snippet means the entry would be dropped downstream anyway;
            # fall back to the title so a bare-link hit still reaches the model.
            if not snippet:
                snippet = (row.get("title") or "").strip()
            if not url or not snippet:
                continue
            entry: dict = {"url": url, "highlights": [snippet]}
            title = (row.get("title") or "").strip()
            if title:
                entry["title"] = title
            out.append(entry)
    return out


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ddg-exa-shim/1.0"

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        # Handy for `curl` sanity checks and readiness probes.
        if self.path.rstrip("/") in ("", "/health"):
            self._send(200, {"status": "ok", "backend": "duckduckgo"})
        else:
            self._send(404, {"error": f"no route for GET {self.path}"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/search":
            self._send(404, {"error": f"no route for POST {self.path}"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send(400, {"error": "bad Content-Length"})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send(400, {"error": "missing or oversized request body"})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            self._send(400, {"error": f"malformed JSON body: {exc}"})
            return

        query = (payload.get("query") or "").strip()
        if not query:
            self._send(400, {"error": "field 'query' is required"})
            return

        requested = payload.get("numResults")
        if isinstance(requested, int) and requested > 0:
            num_results = min(requested, MAX_RESULTS)
        else:
            num_results = DEFAULT_RESULTS

        try:
            results = search(query, num_results)
        except Exception as exc:  # noqa: BLE001 - surface as a clean 502 to dsh
            log.warning("search failed for %r: %s", query, exc)
            self._send(502, {"error": f"DuckDuckGo search failed: {exc}"})
            return

        log.info("query=%r -> %d result(s)", query, len(results))
        self._send(200, {"results": results})

    def log_message(self, fmt: str, *args) -> None:
        log.debug(fmt, *args)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    log.info("ddg-exa-shim listening on http://%s:%d", args.host, args.port)
    log.info("point dsh's exa provider at this baseURL")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
