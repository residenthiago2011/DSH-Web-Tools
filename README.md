# DeepSeek Harness - Web Tools

**Free, keyless `web_search` for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).**

> **Requires dsh 0.2.0-rc.1 or newer.** Works in both 0.2 surfaces: the web UI
> (profile `web`) and DeepSeek's desktop app (profile `desktop`). The desktop
> app has no public download yet; it is built from [DeepSeek's source](https://github.com/deepseek-ai/deepseek-harness).
>
> **Using dsh 0.1.x?** Use the [`dsh-0.1` tag](https://github.com/tonyd2wild/DeepSeek-Harness-Web-Tools/tree/dsh-0.1)
> of the original repo this project builds on (see
> [Credits](#credits)). Its instructions (`settings.yaml`, editing the installed
> `standard` preset) are for 0.1.0-rc.6 and do not apply to 0.2.

Every search provider `dsh` 0.2 ships needs an account: DeepSeek's own search
(a DeepSeek API key, or a DeepSeek-account sign-in), Exa, or Perplexity (their
API keys). If you run `dsh` against a local model you may want none of that.
This repo is the keyless option.

## How it works

The plugin runs inside the `dsh` process and queries search engines directly.
It tries DuckDuckGo first, then Bing when DuckDuckGo is blocked, rate-limited,
or returns no results:

1. DuckDuckGo HTML
2. DuckDuckGo Lite
3. Bing RSS and Bing HTML, with and without market hints

Bing's fallback feed can return unrelated trending pages when it has no real
matches. The plugin scores every candidate against the query terms and discards
results that do not match. If no engine returns anything relevant, the search
fails with an explicit `no relevant results` error instead of returning
unrelated links.

There is no API key and no account in the default setup. Search traffic goes
from the `dsh` process to fixed DuckDuckGo and Bing endpoints over HTTPS.

`web_fetch` needs nothing from this repo. DeepSeek ships
`@deepseek-ai/dsh-web-fetch-http` in the 0.2 base bundle with fetch enabled (see
[Security](#security) for what changed).

Everything here is upgrade-safe: it lives in your profile patch layer
(`cordis.patch.yml`) and `$DSH_HOME`, not in shipped package files.

## What's in here

```text
plugin/    the dsh plugin registering a DDG/Bing-backed WebSearchProvider
examples/  a cordis.patch.yml showing the wiring
```

The provider ID is the historical `ddg-shim`; it must match `web.searchProvider`
in your patch and is kept so existing patches keep working.

## Requirements

- `dsh` **0.2.0-rc.1+**. At the time of writing npm's `latest` tag still points
  at 0.1.x, so install the 0.2 line explicitly: `npm i -g @deepseek-ai/dsh@next`
- **Node** `^22.19.0 || >=24.0.0`
- **pnpm**: `dsh plugin` shells out to it (`npm i -g pnpm`)

## Plugin panel (0.2.1-rc.3+)

> **2.0.0** is the rename release — the package is `@residenthiago/dsh-web-tools`
> (previously `dsh-plugin-ddg-search`[`dsh-0.1`](https://github.com/tonyd2wild/DeepSeek-Harness-Web-Tools/tree/dsh-0.1)). Update profile manifests
> accordingly: the dependency key, `dsh.profile.bundles` entry and the
> bundle row's `name:`; the loader row id stays `web-search-ddg`.

On dsh 0.2.1-rc.3+ the plugin is a **bundle** (`dsh.bundle.patch` in its
`package.json`), so the Plugins panel lists it under **Personal** as
**"Web Tools"** (zh: Web 工具; display name from `plugin/locale/en|zh.json`,
`meta.title`) with the standard enable/disable toggle — enabled it writes
`"@residenthiago/dsh-web-tools"` into the profile manifest's
`dsh.profile.bundles`. In that flow the `- insert: id: web-search-ddg` row
comes from the bundle's own `cordis.patch.yml`; do **not** also copy that row
into the profile patch (duplicate ids conflict). The `- id: web` row from
step 2 is still yours to keep — it belongs to the web seam, not this package.

## Install

### 1. The plugin, per profile

The easiest path is a tarball release through the Plugins panel (**Plugins →
Add plugin** → paste
`https://github.com/residenthiago2011/DSH-Web-Tools/releases/download/v2.0.0/residenthiago-dsh-web-tools-2.0.0.tgz`
— see the
[Releases page](https://github.com/residenthiago2011/DSH-Web-Tools/releases)
for the newest tag). The panel records the install in the profile manifest,
and the bundle patch rows below are then composed automatically. Manual local
install:

Plugins resolve from the **profile** directory, so install into each profile you
use. `web` is the browser UI, `desktop` is DeepSeek's desktop app, `headless` is
one-shot `dsh headless "task"` runs:

```sh
dsh plugin --profile <profile> add link:/absolute/path/to/DSH-Web-Tools/plugin
```

### 2. Wire it up in `cordis.patch.yml`

On 0.2 all configuration lives in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`
(default `$DSH_HOME` is `~/.dsh`); `settings.yaml` is gone. Add these rows to
the file of every profile from step 1 (full commented copy:
[examples/cordis.patch.yml](examples/cordis.patch.yml)):

```yaml
- id: web
  config:
    searchProvider: ddg-shim
    fetchProvider: http

- insert:
    - id: web-search-ddg
      name: '@residenthiago/dsh-web-tools'
      config:
        engine: auto
        maxResults: 8
        timeoutMs: 12000
```

A patch replaces the `web` row's whole config, so `fetchProvider` is restated
even though it is the shipped value.

No agent-preset change is needed: 0.2's shipped `standard` preset already
exposes both `web_search` and `web_fetch` to the model. If you use a custom
preset row, keep its `tool-web` row.

### 3. Restart

- **Web UI:** stop `dsh web` and start it again.
- **Desktop app:** quit it fully and reopen it.

Then start a **new session**; a session that was already open keeps its old
tool catalog.

### Upgrading from 1.0

The provider ID is unchanged. 2.0.0 removed the legacy `baseURL` shim option:
any `baseURL` left in the config is ignored and the plugin always searches
directly. To clean up:

1. Remove `baseURL` from the `web-search-ddg` config.
2. Stop any 1.0-era shim service you were running.
3. Restart `dsh` and open a new session.

You can also delete `engine`, `maxResults`, and `timeoutMs`; they have defaults.

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

## Configuration

The plugin takes these options:

```yaml
- id: web-search-ddg
  name: '@residenthiago/dsh-web-tools'
  config:
    engine: auto
    maxResults: 8
    timeoutMs: 12000
```

| Option | Default | Description |
| --- | --- | --- |
| `engine` | `auto` | `auto`, `duckduckgo`, or `bing`. `auto` tries DuckDuckGo then Bing. |
| `maxResults` | `8` | Maximum results per search, capped at `25`. |
| `timeoutMs` | `12000` | Per-request timeout, capped at `60000`. |
| `userAgent` | Chrome desktop | Override the HTTP user agent. |

`maxResults` is also bounded by `dsh`'s web seam. The provider returns sources
in the seam's `{url, title?, snippet?, publishedAt?}` shape.

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

**New sessions only.** An already-open session keeps its old tool catalog. Start
a new session after changing the profile.

**DuckDuckGo rate-limits under sustained load.** `engine: auto` falls back to
Bing. If both are blocked on your network, use one of the official keyed
providers.

**Keyless upstreams still need `apiKeyEnv`.** Unrelated to this repo but adjacent:
if you configure a local model route in the `llm-pi-ai` row and omit
`apiKeyEnv`, pi-ai falls back to ambient discovery, finds nothing, and fails with
`PI_AI_ERROR: No API key`. Point it at any env var holding a placeholder.

## Security

**Search results are untrusted input.** Treat titles, snippets, and fetched pages
as data, not instructions. A malicious result can contain prompt-injection text.
Do not run unattended agents with broad tool access unless you accept that risk.

**Direct search sends queries to DuckDuckGo and Bing.** The default provider
contacts only fixed search endpoints; it does not fetch arbitrary URLs. It does
send your query text to those services, so do not search for secrets.

**`web_fetch` is on by default in 0.2, and its provider changed.** The 0.1-era
`@deepseek-ai/dsh-web-fetch-http` had no SSRF protection, which is why DeepSeek
shipped fetch disabled back then. The 0.2 provider, per its own README, accepts
only public HTTP(S) destinations: it resolves each host, rejects the request if
any address is not public (loopback, LAN, and most VPN/tailnet ranges), pins
the connection to the validated addresses, and blocks cross-origin redirects.
It still cannot stop a model from sending data *to* a public URL, so think
twice before running an unattended agent with fetch on.

## Development

```sh
cd plugin
npm test
```

The tests use Node's built-in test runner and mock `fetch`; they do not hit the
network. CI runs them on Node 22 and 24.

## Credits

The `web_search` idea and the original implementation come from
**[tonyd2wild/DeepSeek-Harness-Web-Tools](https://github.com/tonyd2wild/DeepSeek-Harness-Web-Tools)**
— the primary work on this concept, and the foundation this repo's direct-fetch
rewrite and tooling build on.

## License

MIT, see [LICENSE](LICENSE).
