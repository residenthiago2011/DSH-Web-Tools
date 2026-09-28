# DeepSeek Harness Web Tools

> ### ⚠️ Unofficial community project
>
> **Not affiliated with, endorsed by, or maintained by DeepSeek AI.** This is a
> third-party add-on for their open-source harness. For the official project see
> [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).
> Please do not report issues with this repo to DeepSeek.

**Free, keyless `web_search` for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), backed by DuckDuckGo.**

> **Requires dsh 0.2.0-rc.1 or newer.** Works in both 0.2 surfaces: the web UI
> (profile `web`) and DeepSeek's desktop app (profile `desktop`).
>
> **Using dsh 0.1.x?** Use the [`dsh-0.1` tag](https://github.com/tonyd2wild/DeepSeek-Harness-Web-Tools/tree/dsh-0.1)
> of this repo. Its instructions (`settings.yaml`, editing the installed
> `standard` preset) are for 0.1.0-rc.6 and do not apply to 0.2.

Every search provider `dsh` 0.2 ships needs an account: DeepSeek's own search
(a DeepSeek API key, or a DeepSeek-account sign-in), Exa, or Perplexity (their
API keys). If you run `dsh` against a local model you may want none of that.
This repo is the keyless option:

- **`web_search`**: a local shim backed by DuckDuckGo, plus a `dsh` plugin that
  registers it with the `ctx.web` seam as the provider `ddg-shim`.
- **`web_fetch`**: nothing to install on 0.2. DeepSeek now ships
  `@deepseek-ai/dsh-web-fetch-http` in the base bundle with fetch switched on
  (see [Security](#security) for what changed).

Everything here is upgrade-safe: it lives in your profile patch layer
(`cordis.patch.yml`) and `$DSH_HOME`, not in shipped package files.

---

## Why a key is normally required

Worth understanding before you install, because it explains why "just point it
at my local model" cannot work.

The default search provider, `deepseek-official`, is pinned via the `web` row's
`searchProvider`. That provider:

1. speaks the **Anthropic Messages** protocol (`POST /messages`), not OpenAI
   `/v1/chat/completions`; and
2. relies on DeepSeek's **server-side** `web_search` tool: the searching happens
   in DeepSeek's cloud.

So a local OpenAI-compatible server (vLLM, llama.cpp, Ollama) cannot serve it,
on either count. **Web search needs a search index**, and a language model does
not have one. The Exa and Perplexity providers solve that with a paid index.
This repo supplies one for free by querying DuckDuckGo locally.

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

- `dsh` **0.2.0-rc.1+**. At the time of writing npm's `latest` tag still points
  at 0.1.x, so install the 0.2 line explicitly: `npm i -g @deepseek-ai/dsh@next`
- **Node** `^22.19.0 || >=24.0.0`
- **Python** 3.9+
- **pnpm**: `dsh plugin` shells out to it (`npm i -g pnpm`)

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

### 2. The plugin, per profile

Plugins resolve from the **profile** directory, so install into each profile you
use (see Gotchas). `web` is the browser UI, `desktop` is DeepSeek's desktop app,
`headless` is one-shot `dsh headless "task"` runs:

```sh
dsh plugin --profile web     add link:/absolute/path/to/DeepSeek-Harness-Web-Tools/plugin
dsh plugin --profile desktop add link:/absolute/path/to/DeepSeek-Harness-Web-Tools/plugin
dsh plugin --profile headless add link:/absolute/path/to/DeepSeek-Harness-Web-Tools/plugin
```

### 3. Wire it up in `cordis.patch.yml`

On 0.2 all configuration lives in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`
(default `$DSH_HOME` is `~/.dsh`); `settings.yaml` is gone. Add these rows to
the file of every profile from step 2 (full commented copy:
[examples/cordis.patch.yml](examples/cordis.patch.yml)):

```yaml
# Point the web seam at the DuckDuckGo shim. A patch REPLACES the row's whole
# config, so fetchProvider is restated even though it is the shipped value.
- id: web
  config:
    searchProvider: ddg-shim
    fetchProvider: http

- insert:
    - id: web-search-ddg
      name: 'dsh-plugin-ddg-search'
      config:
        baseURL: http://127.0.0.1:8899
```

No agent-preset change is needed: 0.2's shipped `standard` preset already
exposes both `web_search` and `web_fetch` to the model. If you use a custom
preset row, keep its `tool-web` row.

### 4. Restart

- **Web UI:** stop `dsh web` and start it again.
- **Desktop app:** quit it fully and reopen it.

Then start a **new session**; a session that was already open keeps its old
tool catalog.

### Upgrading from a 0.1 install

- **The per-profile `@deepseek-ai/dsh-web-fetch-http@0.0.1-rc.5` is refused by
  0.2 as incompatible.** Upgrade it to match the harness
  (`dsh plugin --profile <p> add @deepseek-ai/dsh-web-fetch-http@0.2.0-rc.1`,
  the path we tested), or remove it from the profile, since 0.2's base bundle
  carries its own copy.
- **Your old `- id: web-fetch-http` insert row is now redundant**: the base
  bundle inserts that row itself. Drop it from your patch.
- **The hand edit to the installed `standard` preset is gone** and no longer
  needed. 0.2 declares presets as rows, and the shipped one enables fetch.
- If you ran `dsh` 0.1 with a `settings.yaml`, the 0.2 upgrade migrated it into
  `profiles/web/cordis.patch.yml`. Check that your `web` row survived.

---

## Verify

```sh
# the composed config should show the provider and the plugin row
dsh --profile web --dump-config | grep -n -E "ddg-shim|web-search-ddg"

# one-shot run through a real session
dsh headless "web_search for 'cordis plugin system' and give me one URL"
dsh headless "web_fetch https://example.com and quote its H1"
```

In the web UI or desktop app, ask for something current in a new session and
watch for a `web_search` call in the transcript.

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
[SearXNG](https://github.com/searxng/searxng), point the shim's backend at it:
`search()` in `shim/server.py` is the only function to change. Its contract is
`(query, num_results) -> [{url, title?, highlights: [snippet]}]`.

---

## Gotchas

Each of these cost real debugging time.

**Plugins resolve from the profile directory.** Installing a plugin into the
`dsh` install's own `node_modules` instead makes **every profile crash on boot**
with `ERR_MODULE_NOT_FOUND`, including profiles you did not touch. Always use
`dsh plugin --profile <p> add ...`, once per profile.

**Each profile is its own tree.** `web` and `desktop` have separate
`cordis.patch.yml` files and separate `node_modules`. Configuring one does
nothing for the other.

**A cordis patch replaces a row's whole `config`.** It does not merge. Restate
every field you want to keep, including `fetchProvider` when you set
`searchProvider`.

**The old `@deepseek-ai/dsh-web-search-exa@0.0.1-rc.1` was broken** (it imported
a package that was never published). That is why this repo ships its own
provider. 0.2's Exa and Perplexity providers are the official, keyed
alternatives.

**Keyless upstreams still need `apiKeyEnv`.** Unrelated to this repo but adjacent:
if you configure a local model route in the `llm-pi-ai` row and omit
`apiKeyEnv`, pi-ai falls back to ambient discovery, finds nothing, and fails with
`PI_AI_ERROR: No API key`. Point it at any env var holding a placeholder.

---

## Security

**`web_fetch` is on by default in 0.2, and its provider changed.** The 0.1-era
`@deepseek-ai/dsh-web-fetch-http` had no SSRF protection, which is why DeepSeek
shipped fetch disabled back then. The 0.2 provider, per its own README, accepts
only public HTTP(S) destinations: it resolves each host, rejects the request if
any address is not public (loopback, LAN, and most VPN/tailnet ranges), pins
the connection to the validated addresses, and blocks cross-origin redirects.
It still cannot stop a model from sending data *to* a public URL, so think
twice before running an unattended agent with fetch on.

**The shim has no authentication.** It binds `127.0.0.1` by default. Do not
expose it on `0.0.0.0` without putting authentication in front of it.

---

## License

MIT, see [LICENSE](LICENSE).
