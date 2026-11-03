# dsh-web-tools

Keyless `web_search` provider for DeepSeek Harness. It queries DuckDuckGo and
falls back to Bing when DuckDuckGo is blocked or rate-limited. No API key,
account, or extra process is required.

Bing's RSS fallback sometimes returns unrelated trending pages when a query has
no real matches. The provider ranks candidates against the query terms and drops
unrelated results; if nothing relevant is found it raises a clear error instead
of returning junk.

## Install

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
      name: 'dsh-web-tools'
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
