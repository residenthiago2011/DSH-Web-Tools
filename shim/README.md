# Search shim

**Optional legacy mode.** The plugin now queries DuckDuckGo and Bing directly
from the `dsh` process. This shim is retained for older configurations that set
`baseURL: http://127.0.0.1:8899` and for users who prefer a separate process.

A small local HTTP service that answers `dsh`-side search requests from
DuckDuckGo. No API key, no account, no per-query cost.

## Run it

```sh
python -m venv venv

# Windows
venv\Scripts\python.exe -m pip install -r requirements.txt
venv\Scripts\python.exe server.py

# macOS / Linux
venv/bin/python -m pip install -r requirements.txt
venv/bin/python server.py
```

```sh
curl http://127.0.0.1:8899/health
# {"status": "ok", "backend": "duckduckgo"}
```

Flags: `--host` (default `127.0.0.1`), `--port` (default `8899`), `--verbose`.

## Keep it running

**Windows** — put a shortcut to `start-hidden.vbs` in your Startup folder
(`Win+R` → `shell:startup`). It launches via `pythonw.exe`, so no console
window appears at logon. Paths resolve relative to the script, so the repo can
live anywhere.

**Linux** — see the header of [`dsh-ddg-shim.service`](dsh-ddg-shim.service) for
a per-user systemd unit.

**macOS** — a launchd plist calling `venv/bin/python server.py` with
`RunAtLoad` works; nothing macOS-specific is needed.

## The contract

The shim implements the request/response shape `dsh`'s Exa provider uses, so it
is a drop-in for anything speaking that contract:

```
POST /search
  {"query": "...", "type": "auto",
   "contents": {"highlights": {"highlightsPerUrl": 1}},
   "numResults": 8}

200 OK
  {"results": [{"url": "...", "title": "...", "highlights": ["snippet"]}]}
```

`GET /health` returns `{"status": "ok", "backend": "duckduckgo"}`.

**Every result must carry a non-blank `highlights` entry.** `dsh`'s Exa adapter
drops any result without one — the seam has no other field to derive a snippet
from, so a result with no highlight vanishes silently rather than erroring.
This shim falls back to the title when DuckDuckGo returns no body text.

## Swapping the backend

`search()` is the only backend-specific function. Its contract is
`(query, num_results) -> [{url, title?, highlights: [snippet]}]`. Point it at
SearXNG, Brave, or anything else without touching the HTTP layer.

DuckDuckGo rate-limits under sustained load. If you hit that, a self-hosted
[SearXNG](https://github.com/searxng/searxng) is the usual answer — still free,
still private, no per-query cost.

## Security

There is **no authentication**. It binds loopback by default. Do not put it on
`0.0.0.0` without authentication in front of it — anything that can reach it can
run searches through your IP.
