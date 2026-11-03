import assert from 'node:assert/strict'
import test from 'node:test'

import { DdgSearchProvider, __test, apply } from '../index.js'

const duckDuckGoHtml = `<!doctype html>
<html>
<body>
  <div class="result results_links results_links_deep web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone&amp;rut=abc">Example <b>One</b></a>
    </h2>
    <a class="result__snippet" href="https://example.com/one">First result snippet.</a>
  </div>
  <div class="result results_links results_links_deep web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://example.com/two">Example Two</a>
    </h2>
    <a class="result__snippet">Second result snippet.</a>
  </div>
</body>
</html>`

const bingRss = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Bing</title>
    <item>
      <title>Example Bing One</title>
      <link>https://example.org/one</link>
      <description>Example Bing result snippet.</description>
      <pubDate>Tue, 20 Oct 2026 13:07:00 GMT</pubDate>
    </item>
  </channel>
</rss>`

const bingRssGarbage = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Bing</title>
    <item>
      <title>Proton VPN</title>
      <link>https://protonvpn.com/</link>
      <description>Fast and secure VPN service.</description>
    </item>
  </channel>
</rss>`

const bingHtml = `<ol id="b_results">
  <li class="b_algo">
    <h2><a href="https://example.net/bing">Bing <strong>HTML</strong></a></h2>
    <p class="b_lineclamp4 b_algoSlug">Bing HTML snippet.</p>
  </li>
</ol>`

test('parses DuckDuckGo HTML results', async () => {
  const urls = []
  const provider = new DdgSearchProvider({
    engine: 'duckduckgo',
    fetch: async url => {
      urls.push(String(url))
      return { ok: true, status: 200, text: async () => duckDuckGoHtml }
    },
  })

  const result = await provider.search({ query: 'example', maxResults: 2 })

  assert.equal(result.truncated, false)
  assert.equal(result.sources.length, 2)
  assert.equal(result.sources[0].url, 'https://example.com/one')
  assert.equal(result.sources[0].title, 'Example One')
  assert.equal(result.sources[0].snippet, 'First result snippet.')
  assert.equal(result.sources[1].url, 'https://example.com/two')
  assert.match(urls[0], /html\.duckduckgo\.com/)
})

test('falls back to relevant Bing results when DuckDuckGo is blocked', async () => {
  const urls = []
  const provider = new DdgSearchProvider({
    fetch: async url => {
      const value = String(url)
      urls.push(value)
      if (value.includes('duckduckgo')) {
        return { ok: false, status: 202, text: async () => 'anomaly-modal' }
      }
      if (value.includes('format=rss') && value.includes('setmkt')) {
        return { ok: true, status: 200, text: async () => bingRssGarbage }
      }
      if (value.includes('format=rss')) {
        return { ok: true, status: 200, text: async () => bingRss }
      }
      return { ok: true, status: 200, text: async () => '<ol id="b_results"></ol>' }
    },
  })

  const result = await provider.search({ query: 'example' })

  assert.equal(result.sources.length, 1)
  assert.equal(result.sources[0].url, 'https://example.org/one')
  assert.equal(result.sources[0].title, 'Example Bing One')
  assert.equal(result.sources[0].snippet, 'Example Bing result snippet.')
  assert.equal(result.sources[0].publishedAt, 'Tue, 20 Oct 2026 13:07:00 GMT')
  assert.equal(urls.length, 6)
  assert.match(urls[0], /html\.duckduckgo\.com/)
  assert.match(urls[1], /lite\.duckduckgo\.com/)
  assert.equal(urls.filter(url => url.includes('bing.com')).length, 4)
  assert.ok(urls.some(url => url.includes('setmkt=en-US')))
})

test('rejects Bing results that do not match the query', async () => {
  const provider = new DdgSearchProvider({
    engine: 'bing',
    fetch: async url => ({
      ok: true,
      status: 200,
      text: async () => (String(url).includes('format=rss') ? bingRssGarbage : bingHtml),
    }),
  })

  await assert.rejects(
    provider.search({ query: 'DSH-Tool-Router project' }),
    /no relevant results/,
  )
})

test('prefers results with better query coverage', () => {
  const sources = __test.rankSources([
    { url: 'https://example.com/maceio', title: 'Maceió', snippet: 'A capital of Alagoas.' },
    { url: 'https://example.com/paris', title: 'Paris', snippet: 'The capital of France.' },
  ], 'capital of France')

  assert.deepEqual(sources.map(source => source.url), ['https://example.com/paris'])
})

test('rejects sparse ambiguous matches', () => {
  const sources = __test.rankSources([
    { url: 'https://example.com/vpn', title: 'Proton VPN', snippet: 'Fast and secure VPN service.' },
    { url: 'https://deepseek.com/harness', title: 'DeepSeek Harness', snippet: 'DSH is an agent harness.' },
  ], 'DSH-Tool-Router project')

  assert.deepEqual(sources, [])
})

test('keeps a sparse match when a long query token is present', () => {
  const sources = __test.rankSources([
    { url: 'https://example.com/unrelated', title: 'Unrelated', snippet: 'Nothing useful.' },
    { url: 'https://deepseek.com/harness', title: 'DeepSeek Harness', snippet: 'An agent harness.' },
  ], 'DeepSeek Router Project')

  assert.deepEqual(sources.map(source => source.url), ['https://deepseek.com/harness'])
})

test('keeps the legacy shim contract when baseURL is set', async () => {
  let request
  const provider = new DdgSearchProvider({
    baseURL: 'http://127.0.0.1:8899',
    fetch: async (url, init) => {
      request = { url: String(url), body: JSON.parse(init.body) }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              url: 'https://example.com/shim',
              title: 'Shim result',
              highlights: ['Shim snippet.'],
            },
          ],
        }),
      }
    },
  })

  const result = await provider.search({ query: 'legacy', maxResults: 5 })

  assert.equal(provider.available(), true)
  assert.equal(request.url, 'http://127.0.0.1:8899/search')
  assert.equal(request.body.numResults, 5)
  assert.deepEqual(request.body.contents, { highlights: { highlightsPerUrl: 1 } })
  assert.equal(result.sources[0].url, 'https://example.com/shim')
  assert.equal(result.sources[0].snippet, 'Shim snippet.')
})

test('rejects an invalid shim baseURL', () => {
  assert.throws(() => new DdgSearchProvider({ baseURL: 'not-a-url' }), /baseURL/)
})

test('direct mode is available without a network probe', () => {
  const provider = new DdgSearchProvider({ fetch: async () => { throw new Error('unexpected') } })
  assert.equal(provider.available(), true)
})

test('parses Bing HTML results', () => {
  const sources = __test.parseBingHtml(bingHtml, 5)
  assert.equal(sources.length, 1)
  assert.equal(sources[0].url, 'https://example.net/bing')
  assert.equal(sources[0].title, 'Bing HTML')
  assert.equal(sources[0].snippet, 'Bing HTML snippet.')
})

test('registers the provider with the web seam', () => {
  let provider
  apply({
    web: {
      registerSearchProvider(value) {
        provider = value
      },
    },
  }, { engine: 'bing' })

  assert.equal(provider.id, 'ddg-shim')
  assert.equal(provider.engine, 'bing')
  assert.equal(provider.available(), true)
})
