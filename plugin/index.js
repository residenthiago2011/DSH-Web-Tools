export const name = 'web-search-ddg'

export const inject = ['web']

const PROVIDER_ID = 'ddg-shim'
const DEFAULT_MAX_RESULTS = 8
const MAX_RESULTS = 25
const DEFAULT_TIMEOUT_MS = 12_000
const MAX_TIMEOUT_MS = 60_000
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const VALID_ENGINES = new Set(['auto', 'duckduckgo', 'bing'])
const BING_MARKET_SUFFIXES = ['', '&setmkt=en-US&setlang=en-US&cc=US']
const QUERY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their',
  'this', 'to', 'was', 'were', 'will', 'with',
])

const NAMED_ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

function isValidBaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeEngine(value) {
  if (value === undefined || value === null) return 'auto'
  const engine = String(value).trim().toLowerCase()
  if (!VALID_ENGINES.has(engine)) {
    throw new Error(`engine must be one of ${[...VALID_ENGINES].join(', ')}`)
  }
  return engine
}

function normalizeMaxResults(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_MAX_RESULTS
  return Math.min(Math.floor(number), MAX_RESULTS)
}

function normalizeTimeout(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(Math.floor(number), 1_000), MAX_TIMEOUT_MS)
}

function isAbortError(error) {
  return error?.name === 'AbortError'
}

function mergeSignals(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (signal === undefined) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout])
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  timeout.addEventListener('abort', abort, { once: true })
  return controller.signal
}

function decodeEntities(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity) => {
    const key = entity.toLowerCase()
    try {
      if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16))
      if (key.startsWith('#')) return String.fromCodePoint(Number.parseInt(key.slice(1), 10))
    } catch {
      return match
    }
    return NAMED_ENTITIES[key] ?? match
  })
}

function cleanText(value) {
  return decodeEntities(
    String(value ?? '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function extractAttribute(attributes, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = String(attributes ?? '').match(pattern)
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : ''
}

function decodeBingTarget(value) {
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  if (!value.startsWith('a1')) return value
  try {
    const encoded = value.slice(2).replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    return /^https?:\/\//i.test(decoded) ? decoded : value
  } catch {
    return value
  }
}

function decodeRedirectUrl(value) {
  if (!value) return ''
  const absolute = value.startsWith('//') ? `https:${value}` : value
  try {
    const url = new URL(absolute)
    const target = url.searchParams.get('uddg')
    if (target) return target
    if (url.hostname.endsWith('bing.com') && url.pathname === '/ck/a') {
      return decodeBingTarget(url.searchParams.get('u') ?? '')
    }
    return absolute
  } catch {
    return value
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function makeSource({ url, title, snippet, publishedAt }) {
  const source = { url: String(url).trim() }
  if (typeof title === 'string' && title.trim().length > 0) source.title = title.trim()
  if (typeof snippet === 'string' && snippet.trim().length > 0) source.snippet = snippet.trim()
  if (typeof publishedAt === 'string' && publishedAt.trim().length > 0) {
    source.publishedAt = publishedAt.trim()
  }
  return source
}

function dedupeSources(sources, limit) {
  const seen = new Set()
  const output = []
  for (const source of sources) {
    if (!isHttpUrl(source?.url)) continue
    const key = source.url.replace(/#.*$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    output.push(source)
    if (output.length >= limit) break
  }
  return output
}

function tokenize(value) {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return normalized ? normalized.split(' ') : []
}

function queryTokens(query) {
  return [...new Set(tokenize(query).filter(token => (
    token.length > 1 && !QUERY_STOP_WORDS.has(token)
  )))]
}

function rankSources(sources, query) {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return sources
  const scored = sources.map((source, index) => {
    const text = tokenize(`${source.title ?? ''} ${source.snippet ?? ''} ${source.url ?? ''}`)
    const words = new Set(text)
    const matches = tokens.filter(token => words.has(token))
    return {
      source,
      index,
      score: matches.length / tokens.length,
      matches,
    }
  })
  const best = Math.max(0, ...scored.map(entry => entry.score))
  if (best === 0) return []
  const minimum = best >= 0.5 ? Math.max(0.5, best * 0.75) : 0
  return scored
    .filter(entry => entry.score >= minimum && (
      entry.score >= 0.5
      || entry.matches.some(token => token.length >= 5 && !/^\d+$/.test(token))
    ))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(entry => entry.source)
}

function findFirstAnchor(html) {
  const match = String(html ?? '').match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i)
  if (!match) return undefined
  return {
    href: extractAttribute(match[1], 'href'),
    text: cleanText(match[2]),
  }
}

function readTag(xml, tag) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = String(xml ?? '').match(pattern)
  return match ? cleanText(match[1]) : ''
}

function isDuckDuckGoBlocked(html) {
  return /anomaly-modal|bots use DuckDuckGo|If this error persists|challenge-form/i.test(String(html ?? ''))
}

function parseDuckDuckGoHtml(html, limit) {
  const sources = []
  const blocks = String(html ?? '').split(/<div[^>]+class="[^"]*\bresult\b[^"]*"[^>]*>/i)
  for (const block of blocks.slice(1)) {
    const anchor = block.match(/<a\b([^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/i)
      ?? block.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i)
    if (!anchor) continue
    const url = decodeRedirectUrl(extractAttribute(anchor[1], 'href'))
    if (!isHttpUrl(url)) continue
    const snippetMatch = block.match(/<a\b([^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/i)
      ?? block.match(/<div\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    const snippet = snippetMatch ? cleanText(snippetMatch[2] ?? snippetMatch[1]) : ''
    sources.push(makeSource({ url, title: cleanText(anchor[2]), snippet }))
    if (sources.length >= limit) break
  }
  return sources
}

function parseDuckDuckGoLite(html, limit) {
  const sources = []
  const rows = String(html ?? '').split(/<tr\b[^>]*>/i)
  for (const row of rows.slice(1)) {
    const anchor = row.match(/<a\b([^>]*class="[^"]*\bresult-link\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/i)
      ?? row.match(/<a\b([^>]*href="[^"]*"[^>]*)>([\s\S]*?)<\/a>/i)
    if (!anchor) continue
    const url = decodeRedirectUrl(extractAttribute(anchor[1], 'href'))
    if (!isHttpUrl(url)) continue
    const snippetMatch = row.match(/<td\b[^>]*class="[^"]*\bresult-snippet\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i)
    const snippet = snippetMatch ? cleanText(snippetMatch[1]) : ''
    sources.push(makeSource({ url, title: cleanText(anchor[2]), snippet }))
    if (sources.length >= limit) break
  }
  return sources
}

function parseBingRss(xml, limit) {
  const sources = []
  const items = String(xml ?? '').split(/<item\b[^>]*>/i)
  for (const item of items.slice(1)) {
    const url = decodeRedirectUrl(readTag(item, 'link') || readTag(item, 'guid'))
    if (!isHttpUrl(url)) continue
    sources.push(makeSource({
      url,
      title: readTag(item, 'title'),
      snippet: readTag(item, 'description'),
      publishedAt: readTag(item, 'pubDate'),
    }))
    if (sources.length >= limit) break
  }
  return sources
}

function parseBingHtml(html, limit) {
  const sources = []
  const blocks = String(html ?? '').split(/<li\b[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>/i)
  for (const block of blocks.slice(1)) {
    const heading = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)
    const anchor = findFirstAnchor(heading ? heading[1] : block)
    if (!anchor) continue
    const url = decodeRedirectUrl(anchor.href)
    if (!isHttpUrl(url)) continue
    const snippetMatch = block.match(/<p\b[^>]*class="[^"]*\bb_lineclamp[0-9]*\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      ?? block.match(/<div\b[^>]*class="[^"]*\bb_caption\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    const snippet = snippetMatch ? cleanText(snippetMatch[1]) : ''
    sources.push(makeSource({ url, title: anchor.text, snippet }))
    if (sources.length >= limit) break
  }
  return sources
}

async function requestText(url, { fetchImpl, signal, timeoutMs, userAgent, accept }) {
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept: accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'user-agent': userAgent,
      },
      signal: mergeSignals(signal, timeoutMs),
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    if (error?.name === 'TimeoutError') throw new Error(`request timed out after ${timeoutMs}ms`)
    throw new Error(String(error))
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

export class DdgSearchProvider {
  id = PROVIDER_ID

  constructor(options = {}) {
    if (options.baseURL !== undefined && !isValidBaseUrl(options.baseURL)) {
      throw new Error('baseURL must be an http(s) URL')
    }
    this.baseURL = options.baseURL
    this.engine = normalizeEngine(options.engine)
    this.maxResults = normalizeMaxResults(options.maxResults)
    this.timeoutMs = normalizeTimeout(options.timeoutMs)
    this.userAgent = typeof options.userAgent === 'string' && options.userAgent.trim().length > 0
      ? options.userAgent.trim()
      : DEFAULT_USER_AGENT
    this.fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof this.fetchImpl !== 'function') throw new Error('fetch is not available')
  }

  available() {
    if (this.baseURL !== undefined) return isValidBaseUrl(this.baseURL)
    return true
  }

  async search(request, signal) {
    const query = typeof request?.query === 'string' ? request.query.trim() : ''
    if (!query) throw new Error('query is required')
    const maxResults = normalizeMaxResults(request?.maxResults ?? this.maxResults)
    if (this.baseURL !== undefined) return this.searchShim(query, maxResults, signal)
    return this.searchDirect(query, maxResults, signal)
  }

  async searchShim(query, maxResults, signal) {
    let response
    try {
      response = await this.fetchImpl(`${this.baseURL}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query,
          type: 'auto',
          contents: { highlights: { highlightsPerUrl: 1 } },
          numResults: maxResults,
        }),
        signal: mergeSignals(signal, this.timeoutMs),
      })
    } catch (error) {
      if (isAbortError(error)) throw new Error('DuckDuckGo search aborted')
      if (error?.name === 'TimeoutError') throw new Error('DuckDuckGo shim request timed out')
      throw new Error(
        `DuckDuckGo shim unreachable at ${this.baseURL} (${String(error)}). `
        + 'Is the shim running? See shim/README.md.',
      )
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`
      try {
        const parsed = await response.json()
        if (typeof parsed?.error === 'string' && parsed.error.length > 0) detail = parsed.error
      } catch {
        detail = `HTTP ${response.status}`
      }
      throw new Error(`DuckDuckGo shim error: ${detail}`)
    }

    let payload
    try {
      payload = await response.json()
    } catch (error) {
      throw new Error(`DuckDuckGo shim returned an unprocessable body: ${String(error)}`)
    }

    const sources = []
    for (const result of payload?.results ?? []) {
      if (typeof result?.url !== 'string' || result.url.length === 0) continue
      const snippet = (result.highlights ?? []).find(highlight => (
        typeof highlight === 'string' && highlight.trim().length > 0
      ))
      sources.push(makeSource({ url: result.url, title: result.title, snippet }))
    }
    return { sources: dedupeSources(sources, maxResults), truncated: false }
  }

  async searchDirect(query, maxResults, signal) {
    const engines = this.engine === 'auto' ? ['duckduckgo', 'bing'] : [this.engine]
    const failures = []
    for (const engine of engines) {
      if (engine === 'duckduckgo') {
        for (const attempt of [this.searchDuckDuckGoHtml, this.searchDuckDuckGoLite]) {
          try {
            const sources = await attempt.call(this, query, maxResults, signal)
            const relevant = rankSources(sources, query).slice(0, maxResults)
            if (relevant.length > 0) {
              return { sources: dedupeSources(relevant, maxResults), truncated: false }
            }
            failures.push(`${attempt.name}: no relevant results`)
          } catch (error) {
            if (isAbortError(error) || signal?.aborted) throw new Error('Web search aborted')
            failures.push(`${attempt.name}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        continue
      }

      const attempts = BING_MARKET_SUFFIXES.flatMap(suffix => [
        { name: 'searchBingRss', suffix, run: this.searchBingRss },
        { name: 'searchBingHtml', suffix, run: this.searchBingHtml },
      ])
      const settled = await Promise.allSettled(attempts.map(attempt => (
        attempt.run.call(this, query, maxResults, signal, attempt.suffix)
      )))
      if (signal?.aborted) throw new Error('Web search aborted')
      const candidates = []
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          candidates.push(...result.value)
        } else {
          const attempt = attempts[index]
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
          failures.push(`${attempt.name}${attempt.suffix ? ' market' : ''}: ${message}`)
        }
      })
      const relevant = rankSources(candidates, query).slice(0, maxResults)
      if (relevant.length > 0) {
        return { sources: dedupeSources(relevant, maxResults), truncated: false }
      }
      failures.push('bing: no relevant results')
    }
    throw new Error(`Web search failed for ${JSON.stringify(query)} (${failures.join('; ')})`)
  }

  async searchDuckDuckGoHtml(query, maxResults, signal) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`
    const html = await requestText(url, { ...this, signal })
    if (isDuckDuckGoBlocked(html)) throw new Error('DuckDuckGo returned a bot challenge')
    return parseDuckDuckGoHtml(html, maxResults)
  }

  async searchDuckDuckGoLite(query, maxResults, signal) {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=us-en`
    const html = await requestText(url, { ...this, signal })
    if (isDuckDuckGoBlocked(html)) throw new Error('DuckDuckGo returned a bot challenge')
    return parseDuckDuckGoLite(html, maxResults)
  }

  async searchBingRss(query, maxResults, signal, market = '') {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=${maxResults}${market}`
    const xml = await requestText(url, {
      ...this,
      signal,
      accept: 'application/rss+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.7',
    })
    return parseBingRss(xml, maxResults)
  }

  async searchBingHtml(query, maxResults, signal, market = '') {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}${market}`
    const html = await requestText(url, { ...this, signal })
    return parseBingHtml(html, maxResults)
  }
}

export function apply(ctx, config) {
  ctx.web.registerSearchProvider(new DdgSearchProvider(config ?? {}))
}

export const __test = {
  parseBingHtml,
  parseBingRss,
  parseDuckDuckGoHtml,
  parseDuckDuckGoLite,
  rankSources,
}
