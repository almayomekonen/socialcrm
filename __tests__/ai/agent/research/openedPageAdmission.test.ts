/**
 * Phase 4e — an opened page is evidence; a search hit is not.
 *
 * THE CASE THIS EXISTS FOR. R01 of the research evaluation searched twice,
 * opened pages, cited nothing, and was refused as `no-sources`: the agent had
 * genuinely read the web and could say nothing about it. Citation is the model's
 * own attribution behaviour, not a record of what it consulted, so resting
 * grounding solely on it makes an answer's admissibility depend on whether the
 * model remembered to annotate.
 *
 * THE LINE THIS FILE DEFENDS is the one that must not move with it.
 * `action.sources` carries 12-20 engine results per call that the model may
 * never have opened; admitting one would assert a source for a page nobody
 * read. Opened and cited are admissible. Discovered is not, and several tests
 * below exist only to keep it that way.
 */
import { describe, expect, it } from 'vitest'
import { harvestSources, openedPageUrls, DEFAULT_HARVEST_LIMITS } from '@/lib/agent/research/harvest'

const AT = '2026-09-08T00:00:00.000Z'
const PRICING = 'https://www.pipedrive.com/en/pricing'

/** A `web_search_call` search action, as observed: engine hits, no title. */
const searchAction = (urls: string[]) => ({
  toolName: 'web_search',
  providerExecuted: true,
  output: { action: { type: 'search', query: 'crm pricing' }, sources: urls.map((url) => ({ type: 'url', url })) },
})

/** A `web_search_call` openPage action, as observed: one URL, no sources. */
const openAction = (url: string) => ({
  toolName: 'web_search',
  providerExecuted: true,
  output: { action: { type: 'openPage', url } },
})

/** A `result.sources` entry, built from a `url_citation` annotation. */
const citation = (url: string, title = 'Pricing') => ({ type: 'source', sourceType: 'url', id: 'c1', url, title })

const harvest = (cited: unknown[], toolResults: unknown[]) =>
  harvestSources(cited as never, { retrievedAt: AT, opened: openedPageUrls(toolResults) })

// ── the extractor ───────────────────────────────────────────────────────────

describe('openedPageUrls reads only what was actually fetched', () => {
  it('returns the URL of every openPage action', () => {
    expect(openedPageUrls([openAction(PRICING), openAction('https://monday.com/pricing')]))
      .toEqual([PRICING, 'https://monday.com/pricing'])
  })

  it('returns NOTHING from a search action, however many hits it carried', () => {
    // The whole point: discovery is not evidence.
    expect(openedPageUrls([searchAction(Array.from({ length: 20 }, (_, i) => `https://s${i}.test/p`))])).toEqual([])
  })

  it('ignores findInPage — it searches a page already opened, and would double-count', () => {
    const findIn = { output: { action: { type: 'findInPage', url: PRICING, pattern: 'price' } } }
    expect(openedPageUrls([findIn])).toEqual([])
  })

  it('survives malformed provider payloads without throwing', () => {
    expect(openedPageUrls([null, {}, { output: null }, { output: { action: null } }, { output: { action: { type: 'openPage' } } }])).toEqual([])
    expect(openedPageUrls(undefined)).toEqual([])
  })
})

// ── admission ───────────────────────────────────────────────────────────────

describe('what becomes grounded external evidence', () => {
  it('search-only, nothing cited → zero evidence', () => {
    const out = harvest([], [searchAction([PRICING, 'https://monday.com/pricing'])])
    expect(out.refs).toHaveLength(0)
    expect(out.rawRecords).toBe(0)
  })

  it('a search result that was never opened is never evidence', () => {
    // Thirteen hits, one page opened. Only the opened one is admissible.
    const out = harvest([], [
      searchAction([PRICING, 'https://a.test/1', 'https://b.test/2']),
      openAction(PRICING),
    ])
    expect(out.refs.map((r) => r.url)).toEqual([PRICING])
    expect(out.refs).toHaveLength(1)
  })

  it('search + openPage → the opened URL grounds a claim', () => {
    const out = harvest([], [searchAction([PRICING]), openAction(PRICING)])
    expect(out.refs).toHaveLength(1)
    expect(out.refs[0]).toMatchObject({ kind: 'source', refId: 'src_1', url: PRICING, opened: true, cited: false })
  })

  it('an opened page with no citation is grounded but UNCITED', () => {
    // Exactly R01's shape: the model read it and never attributed it.
    const out = harvest([], [openAction(PRICING)])
    expect(out.refs[0]!.opened).toBe(true)
    expect(out.refs[0]!.cited).toBe(false)
    // No title from an openPage action, so the domain stands in — always true.
    expect(out.refs[0]!.title).toBe('pipedrive.com')
  })

  it('an opened page that was also cited is grounded AND cited, once', () => {
    const out = harvest([citation(PRICING, 'Pricing | Pipedrive')], [openAction(PRICING)])
    expect(out.refs).toHaveLength(1)
    expect(out.refs[0]).toMatchObject({ opened: true, cited: true, title: 'Pricing | Pipedrive' })
  })

  it('a cited page that was never opened stays admissible', () => {
    // The pre-existing channel is untouched.
    const out = harvest([citation(PRICING)], [])
    expect(out.refs).toHaveLength(1)
    expect(out.refs[0]).toMatchObject({ cited: true, opened: false })
  })
})

// ── canonicalisation and caps ───────────────────────────────────────────────

describe('the existing seam still does the work', () => {
  it('duplicate opened URLs collapse through canonicalisation', () => {
    const out = harvest([], [openAction(PRICING), openAction(`${PRICING}?utm_source=openai`), openAction(PRICING)])
    expect(out.rawRecords).toBe(3)
    expect(out.unique).toBe(1)
    expect(out.refs).toHaveLength(1)
    // The citation keeps the URL the provider actually fetched.
    expect(out.refs[0]!.url).toBe(PRICING)
  })

  it('the same URL opened and cited collapses to ONE canonical source', () => {
    const out = harvest([citation(`${PRICING}?utm_source=openai`, 'Pricing')], [openAction(PRICING)])
    expect(out.rawRecords).toBe(2)
    expect(out.unique).toBe(1)
    expect(out.refs).toHaveLength(1)
    expect(out.refs[0]).toMatchObject({ opened: true, cited: true })
  })

  it('the source cap still bites, counting both channels together', () => {
    const opened = Array.from({ length: 12 }, (_, i) => openAction(`https://d${i}.test/p`))
    const out = harvest([], opened)
    expect(out.unique).toBe(12)
    expect(out.refs).toHaveLength(DEFAULT_HARVEST_LIMITS.maxSources)
    expect(out.cappedOut).toBe(12 - DEFAULT_HARVEST_LIMITS.maxSources)
  })

  it('the per-domain cap still bites on opened pages', () => {
    // Four pages from one publisher must not read as four confirmations.
    const out = harvest([], [1, 2, 3, 4].map((n) => openAction(`https://www.pipedrive.com/p/${n}`)))
    expect(out.unique).toBe(4)
    expect(out.refs).toHaveLength(DEFAULT_HARVEST_LIMITS.maxPerDomain)
    expect(out.byDomain).toEqual({ 'pipedrive.com': DEFAULT_HARVEST_LIMITS.maxPerDomain })
  })

  it('an unusable opened URL is rejected, not admitted', () => {
    const out = harvest([], [openAction('javascript:alert(1)'), openAction('not-a-url'), openAction(PRICING)])
    expect(out.unusable).toBe(2)
    expect(out.refs).toHaveLength(1)
  })

  it('refIds stay sequential and opaque across the merged set', () => {
    const out = harvest([citation('https://a.test/1', 'A')], [openAction('https://b.test/2')])
    expect(out.refs.map((r) => r.refId)).toEqual(['src_1', 'src_2'])
  })
})

// ── the line that must not move ─────────────────────────────────────────────

describe('action.sources is never admitted, by any path', () => {
  it('a search carrying twenty hits and no open contributes nothing', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `https://hit${i}.test/p`)
    const out = harvest([], [searchAction(twenty)])
    expect(out.refs).toHaveLength(0)
    expect(out.rawRecords).toBe(0)
    expect(out.unique).toBe(0)
  })

  it('no engine hit leaks in even when a DIFFERENT page was opened', () => {
    const out = harvest([], [searchAction(['https://hit1.test/p', 'https://hit2.test/p']), openAction(PRICING)])
    expect(out.refs.map((r) => r.domain)).toEqual(['pipedrive.com'])
  })

  it('harvestSources ignores a sources array handed to it as tool results', () => {
    // Defence against a future caller passing the wrong channel by mistake.
    expect(openedPageUrls([{ output: { sources: [{ type: 'url', url: PRICING }] } }])).toEqual([])
  })
})
