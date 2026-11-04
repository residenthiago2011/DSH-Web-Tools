# DeepSeek Harness - Web Tools

Keyless `web_search` provider for DeepSeek Harness. It queries DuckDuckGo and
falls back to Bing when DuckDuckGo is blocked or rate-limited. No API key,
account, or extra process is required.

Bing's RSS fallback sometimes returns unrelated trending pages when a query has
no real matches. The provider ranks candidates against the query terms and drops
unrelated results; if nothing relevant is found it raises a clear error instead
of returning junk.

## Install

### From a GitHub Release (plugin panel / tarball URL)

DeepSeek Harness → **Plugins** → **Add plugin** → Registry: **Official npm
registry** → paste:

```text
https://github.com/residenthiago2011/DSH-Web-Tools/releases/download/v2.0.0/residenthiago-dsh-web-tools-2.0.0.tgz
```

Pick the newest tag from the
[Releases page](https://github.com/residenthiago2011/DSH-Web-Tools/releases);
each release also carries a `SHA256SUMS.txt` for `sha256sum -c`. To remove the
plugin later, open its card → **Uninstall** (the profile must run with HMR
enabled for the panel uninstall; otherwise use `dsh plugin remove`).

### From a local checkout

```sh
dsh plugin --profile web add link:/absolute/path/to/DSH-Web-Tools/plugin
```

Add the provider to `$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

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

The provider ID is the historical `ddg-shim`; it must match `web.searchProvider`
and is kept so existing patches continue to work.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `engine` | `auto` | `auto`, `duckduckgo`, or `bing`. `auto` tries DuckDuckGo then Bing. |
| `maxResults` | `8` | Maximum results per search, capped at `25`. |
| `timeoutMs` | `12000` | Per-request timeout, capped at `60000`. |
| `userAgent` | Chrome desktop | Override the HTTP user agent. |

## Tests

```sh
npm test
```
