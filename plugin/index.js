/**
 * dsh-plugin-ddg-search: a free, keyless `web_search` provider for DeepSeek
 * Harness, backed by the local DuckDuckGo shim in this repo's `shim/`.
 *
 * Registers INTO `ctx.web`'s provider registry; it does not own the seam key
 * (`@deepseek-ai/dsh-web` does). Contract, from the seam's `types.ts`:
 *
 *   WebSearchProvider = {
 *     id: string
 *     available(): boolean            // cheap + local; NO network calls
 *     search(req, signal?): Promise<{sources, truncated, content?}>
 *   }
 *   WebSearchSource = {url, title?, snippet?, publishedAt?}
 *
 * Why not `@deepseek-ai/dsh-web-search-exa`, which honours a `baseURL` and
 * would otherwise be the natural host for this: version 0.0.1-rc.1 imports
 * `@deepseek-ai/dsh-environment`, a package that was never published and that
 * it does not declare as a dependency, so it dies at load with
 * ERR_MODULE_NOT_FOUND and takes the whole profile down with it.
 *
 * @module dsh-plugin-ddg-search
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-ddg'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_BASE_URL = 'http://127.0.0.1:8899'

/** Provider id; must match `web.searchProvider` in your profile patch. */
const PROVIDER_ID = 'ddg-shim'

/**
 * @param {string} value
 * @returns {boolean} whether `value` parses as an http(s) URL.
 */
function isValidBaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

class DdgSearchProvider {
  id = PROVIDER_ID

  /** @param {{baseURL: string}} options */
  constructor(options) {
    this.options = options
  }

  available() {
    // Must stay local: the seam calls this to PICK a provider, not to probe it.
    // A network call here would run on every provider resolution.
    return isValidBaseUrl(this.options.baseURL)
  }

  /**
   * Run one search against the shim.
   *
   * @param {{query: string, maxResults?: number}} request
   * @param {AbortSignal} [signal]
   * @returns {Promise<{sources: Array<{url: string, title?: string, snippet?: string}>, truncated: boolean}>}
   */
  async search(request, signal) {
    const body = {
      query: request.query,
      type: 'auto',
      contents: { highlights: { highlightsPerUrl: 1 } },
    }
    // Applying the bound at the request layer is a cost/latency optimization;
    // the seam enforces it regardless.
    if (typeof request.maxResults === 'number' && request.maxResults > 0) {
      body.numResults = request.maxResults
    }

    let response
    try {
      response = await fetch(`${this.options.baseURL}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json',
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('DuckDuckGo search aborted')
      }
      // The shim is a local process; a connection refusal almost always means
      // it simply is not running. Say so rather than leaking a bare
      // ECONNREFUSED that reads like a network fault.
      throw new Error(
        `DuckDuckGo shim unreachable at ${this.options.baseURL} (${String(error)}). `
        + 'Is the shim running? See shim/README.md.',
      )
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`
      try {
        const parsed = await response.json()
        if (typeof parsed?.error === 'string' && parsed.error.length > 0) detail = parsed.error
      } catch {
        // A non-JSON error body is normal for some failures; keep the status.
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
      const snippet = (result.highlights ?? []).find(h => typeof h === 'string' && h.trim().length > 0)
      const source = { url: result.url }
      if (typeof result.title === 'string' && result.title.length > 0) source.title = result.title
      // A snippet-less hit is KEPT: DuckDuckGo always gives a URL and usually a
      // title, and a bare link still beats dropping the result silently.
      if (snippet !== undefined) source.snippet = snippet
      sources.push(source)
    }

    // The seam owns final `maxResults` truncation, so report truncated: false.
    return { sources, truncated: false }
  }
}

/**
 * Register the DuckDuckGo search provider with `ctx.web`.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{baseURL?: string}} [config]
 */
export function apply(ctx, config) {
  const baseURL = config?.baseURL ?? DEFAULT_BASE_URL
  ctx.web.registerSearchProvider(new DdgSearchProvider({ baseURL }))
}
