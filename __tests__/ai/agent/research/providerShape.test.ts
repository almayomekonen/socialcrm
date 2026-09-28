/**
 * What the provider actually returns, pinned.
 *
 * WHY THIS FILE EXISTS. R01 of the research evaluation refused to answer after
 * two searches harvested zero sources, and the obvious explanation — "we should
 * read `web_search_call.results`" — turned out to be wrong twice over: that
 * surface is never requested and never arrives, and the data R01 needed was
 * already present under a different key. A shape assumption that costs an
 * investigation to re-derive is worth writing down.
 *
 * MEASURED 2026-09-08 against gpt-5.6, ai@6.0.176, @ai-sdk/openai@3.0.63, over
 * seven scenarios: search-only, search+openPage, multiple searches, multiple
 * opened pages, duplicate source, page opened after a search result, and a
 * question with no usable source. The fixtures below are the SHAPES observed —
 * key names, action kinds and counts. No page text, no answer prose, no
 * credentials: the structure is the evidence, and the content is exactly what
 * this system refuses to store.
 *
 * THERE ARE THREE SEPARATE SURFACES, and conflating them is the whole trap:
 *
 *   action.sources     what the search ENGINE returned   12–20 per call, {type,url}, no title
 *   action.url         what the model actually OPENED    one per openPage action
 *   result.sources     what the model actually CITED     1–2 per run, {id,sourceType,title,type,url}
 *
 * `harvestSources` reads the THIRD. That is why a run can open pages, read them,
 * and still harvest nothing: opening is not citing.
 */
import { describe, expect, it } from 'vitest'
import { harvestSources, DEFAULT_HARVEST_LIMITS } from '@/lib/agent/research/harvest'

const AT = '2026-09-08T00:00:00.000Z'

/** `mapWebSearchOutput` for a `search` action, as observed (S1, S3, S5). */
const searchResult = (urls: string[]) => ({
  action: { type: 'search', query: 'pipedrive pricing' },
  sources: urls.map((url) => ({ type: 'url', url })),
})

/** `mapWebSearchOutput` for an `open_page` action, as observed (S4 ×2, S6). */
const openPageResult = (url: string) => ({ action: { type: 'openPage', url } })

/** `result.sources`, built from `url_citation` annotations on the answer text. */
const citation = (url: string, title: string) => ({ type: 'source', sourceType: 'url', id: 'cit_1', url, title })

describe('the search action', () => {
  it('carries a large engine result set with URL and nothing else', () => {
    const out = searchResult(['https://www.pipedrive.com/en/pricing', 'https://monday.com/pricing'])
    expect(out.action.type).toBe('search')
    // Observed 12–20 entries per call; each is a bare {type,url}.
    expect(Object.keys(out.sources[0]!).sort()).toEqual(['type', 'url'])
    // No title, no domain, no snippet — nothing to describe the page with.
    expect('title' in out.sources[0]!).toBe(false)
  })

  it('never carries a `results` array', () => {
    /**
     * `web_search_call.results` is the surface the investigation was pointed at.
     * @ai-sdk/openai@3.0.63 requests only `web_search_call.action.sources`
     * (`addInclude`), its `web_search_call` schema has no `results` field, and
     * all seven live scenarios returned output keys of exactly ['action'] or
     * ['action','sources']. It cannot be read because it is never asked for.
     */
    expect('results' in searchResult(['https://a.test/x'])).toBe(false)
  })
})

describe('the openPage action', () => {
  it('carries the exact URL the model fetched', () => {
    const out = openPageResult('https://www.pipedrive.com/en/pricing')
    expect(out.action.type).toBe('openPage')
    // Deterministic association: the page read IS identified, by URL.
    expect(out.action.url).toBe('https://www.pipedrive.com/en/pricing')
  })

  it('carries NO sources array — which is why opened pages are invisible today', () => {
    const out = openPageResult('https://www.pipedrive.com/en/pricing') as Record<string, unknown>
    expect('sources' in out).toBe(false)
    // And `harvestSources` reads a sources array, so an opened page contributes
    // nothing to evidence however carefully the model read it.
    expect(harvestSources(undefined, { retrievedAt: AT }).refs).toHaveLength(0)
  })
})

describe('result.sources is the citation channel, not the search channel', () => {
  it('carries a title and an id, which the engine results do not', () => {
    const s = citation('https://www.pipedrive.com/en/pricing', 'Pricing | Pipedrive')
    expect(Object.keys(s).sort()).toEqual(['id', 'sourceType', 'title', 'type', 'url'])
    const harvested = harvestSources([s], { retrievedAt: AT })
    expect(harvested.refs).toHaveLength(1)
    expect(harvested.refs[0]!.title).toBe('Pricing | Pipedrive')
  })

  it('is far SMALLER than the engine result set — 1–2 cited against 12–20 found', () => {
    /**
     * The measurement that explains R01. A run can search broadly and cite
     * nothing; `rawRecords` counts citations, not search hits, so "0 sources"
     * means "the model cited nothing", never "the search failed".
     */
    const engine = searchResult(Array.from({ length: 13 }, (_, i) => `https://site${i}.test/p`))
    expect(engine.sources).toHaveLength(13)
    expect(harvestSources([], { retrievedAt: AT }).rawRecords).toBe(0)
  })

  it('contains duplicates, which canonical dedupe collapses', () => {
    // S5: two citation entries over one distinct URL.
    const dup = [
      citation('https://www.pipedrive.com/en/pricing', 'Pricing'),
      citation('https://www.pipedrive.com/en/pricing?utm_source=openai', 'Pricing'),
    ]
    const out = harvestSources(dup, { retrievedAt: AT })
    expect(out.rawRecords).toBe(2)
    expect(out.unique).toBe(1)
    // Citation keeps the URL the provider actually fetched, not the canonical form.
    expect(out.refs[0]!.url).toBe('https://www.pipedrive.com/en/pricing')
  })

  it('is empty when the model never searched at all', () => {
    // S7: a question with no usable source produced ZERO tool calls.
    const out = harvestSources([], { retrievedAt: AT })
    expect(out).toMatchObject({ rawRecords: 0, unique: 0, cappedOut: 0, unusable: 0 })
    expect(out.refs).toHaveLength(0)
  })
})

describe('the three surfaces are distinguishable', () => {
  it('searched, opened and cited can each be told apart', () => {
    const searched = searchResult(['https://a.test/1', 'https://b.test/2'])
    const opened = openPageResult('https://a.test/1')
    const cited = citation('https://a.test/1', 'A')

    // Searched: an action of type `search` carrying engine hits.
    expect(searched.action.type).toBe('search')
    expect(searched.sources.length).toBeGreaterThan(0)
    // Opened: an action of type `openPage` carrying one URL and no hits.
    expect(opened.action.type).toBe('openPage')
    expect('sources' in opened).toBe(false)
    // Cited: a source record with an id and a title.
    expect(cited.sourceType).toBe('url')
    expect(cited.title).toBeTruthy()
  })

  it('harvest admits ONLY the cited channel today', () => {
    // The gap, stated as a test rather than as a comment: an opened page that
    // was never cited contributes nothing, and this is the current contract.
    const openedButNotCited = harvestSources([], { retrievedAt: AT })
    expect(openedButNotCited.refs).toHaveLength(0)
    expect(DEFAULT_HARVEST_LIMITS).toEqual({ maxSources: 8, maxPerDomain: 2 })
  })
})
