# DeepSeek Harness Web Tools

> ### ⚠️ Unofficial community project
>
> **Not affiliated with, endorsed by, or maintained by DeepSeek AI.** This is a
> third-party add-on for their open-source harness. For the official project see
> [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).
> Please do not report issues with this repo to DeepSeek.

**Free, keyless `web_search` and `web_fetch` for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).**

Out of the box, `dsh`'s `web_search` requires a paid API key and `web_fetch` ships disabled. If you run `dsh` against a local model, you probably wanted neither of those things. This repo gets you both, for free, with no signup:

- **`web_search`** — a local shim backed by DuckDuckGo, plus a `dsh` plugin that registers it with the `ctx.web` seam.
- **`web_fetch`** — configuration to enable the provider DeepSeek already publishes.

Everything here is upgrade-safe: it lives in your profile patch layer and `$DSH_HOME`, not in shipped package files.

---

## Why a key is normally required

Worth understanding before you install, because it explains why "just point it at my local model" cannot work.

`dsh` ships one search provider, `deepseek-official`, pinned via `web.searchProvider`. That provider:

1. speaks the **Anthropic Messages** protocol (`POST /messages`), not OpenAI `/v1/chat/completions`; and
2. relies on DeepSeek's **server-side** `web_search` tool — the searching happens in DeepSeek's cloud.

So a local OpenAI-compatible server (vLLM, llama.cpp, Ollama) cannot serve it, on either count. **Web search needs a search index**, and a language model does not have one. That is the actual constraint — no amount of local configuration removes it.

This repo supplies the index by querying DuckDuckGo locally.

---

## What's in here

```
plugin/    a dsh plugin registering a DuckDuckGo-backed WebSearchProvider
shim/      a small local HTTP service that queries DuckDuckGo
examples/  a cordis.patch.yml showing the wiring
```

The shim is a separate process rather than code inside the plugin because the
DuckDuckGo client with the best maintenance story is Python (`ddgs`), and `dsh`
plugins are JavaScript. The plugin talks to it over loopback HTTP.

---

## Requirements

- `dsh` installed (`npm i -g @deepseek-ai/dsh`) — tested against **0.1.0-rc.6**
- **Node** `^22.19.0 || >=24.0.0`
- **Python** 3.9+
- **pnpm** — `dsh plugin` shells out to it (`npm i -g pnpm`)

---

## Install

### 1. The search shim

```sh
cd shim
python -m venv venv

# Windows
venv\Scripts\python.exe -m pip install -r requirements.txt
venv\Scripts\python.exe server.py

# macOS / Linux
venv/bin/python -m pip install -r requirements.txt
venv/bin/python server.py
```

It listens on `127.0.0.1:8899`. Check it:

```sh
curl http://127.0.0.1:8899/health
# {"status": "ok", "backend": "duckduckgo"}
```

To keep it running, see [shim/README.md](shim/README.md) for a Windows
Startup-folder launcher and a Linux systemd unit.

### 2. The plugin and the fetch provider

Install into **each profile** you use — `plugins resolve from the profile
directory`, so this matters (see Gotchas):

```sh
dsh plugin --profile web add /absolute/path/to/DeepSeek-Harness-Web-Tools/plugin
dsh plugin --profile web add @deepseek-ai/dsh-web-fetch-http

dsh plugin --profile headless add /absolute/path/to/DeepSeek-Harness-Web-Tools/plugin
dsh plugin --profile headless add @deepseek-ai/dsh-web-fetch-http
```

### 3. Wire it up

Copy [examples/cordis.patch.yml](examples/cordis.patch.yml) into
`$DSH_HOME/profiles/<profile>/cordis.patch.yml` (default `$DSH_HOME` is `~/.dsh`).

### 4. Enable the agent-facing fetch tool

`web_fetch` is disabled per **agent preset**, and presets ship read-only inside
the `dsh` install. In your installed `config/agent-presets/standard/agent.cordis.yml`:

```yaml
- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: true          # was: false
    searchTimeoutMs: 60000
```

This is the one change that does **not** survive `npm i -g @deepseek-ai/dsh`.
Re-apply it after upgrades. `web_search` needs no preset change.

### 5. Restart

```sh
dsh web
```

---

## Verify

```sh
dsh --profile headless "web_search for 'cordis plugin system' and give me one URL"
dsh --profile headless "web_fetch https://example.com and quote its H1"
```

---

## Configuration

The plugin takes one option:

```yaml
- id: web-search-ddg
  name: 'dsh-plugin-ddg-search'
  config:
    baseURL: http://127.0.0.1:8899
```

The shim takes `--host`, `--port`, and `--verbose`.

### Using SearXNG instead

DuckDuckGo rate-limits under heavy use. If you already run
[SearXNG](https://github.com/searxng/searxng), point the shim's backend at it —
`search()` in `shim/server.py` is the only function to change. Its contract is
`(query, num_results) -> [{url, title?, highlights: [snippet]}]`.

---

## Gotchas

Each of these cost real debugging time.

**Plugins resolve from the profile directory.** Installing a plugin into the
`dsh` install's own `node_modules` instead makes **every profile crash on boot**
with `ERR_MODULE_NOT_FOUND` — including profiles you did not touch. Always use
`dsh plugin --profile <p> add ...`.

**`@deepseek-ai/dsh-web-search-exa@0.0.1-rc.1` is broken.** It imports
`@deepseek-ai/dsh-environment`, a package that was never published and that it
does not declare as a dependency. Installing it takes the profile down. That
package would otherwise have been the natural host for this (it honours a
`baseURL`), which is why this repo ships its own provider.

**A cordis patch replaces a row's whole `config`.** It does not merge. Restate
every field you want to keep — including `searchProvider` when you set
`fetchProvider`.

**Keyless upstreams still need `apiKeyEnv`.** Unrelated to this repo but adjacent:
if you configure a local model route and omit `apiKeyEnv`, pi-ai falls back to
ambient discovery, finds nothing, and fails with `PI_AI_ERROR: No API key`. Point
it at any env var holding a placeholder.

---

## Security

**`@deepseek-ai/dsh-web-fetch-http` has no SSRF protection.** DeepSeek ships
`fetch: false` deliberately for this reason, and says so in `dsh-base`: *the
model chooses the request target*. An agent with fetch enabled can reach
anything your machine can — `localhost`, LAN, VPN/tailnet hosts, cloud metadata
endpoints. Enable it knowing that, and think twice before running an unattended
agent with it on.

**The shim has no authentication.** It binds `127.0.0.1` by default. Do not
expose it on `0.0.0.0` without putting authentication in front of it.

---

## License

MIT — see [LICENSE](LICENSE).
