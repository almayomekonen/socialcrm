/**
 * PROVIDER-RESOURCE ACCOUNTING, and the normalization it rests on.
 *
 * The claim under test is that research is measurable in its own terms rather
 * than inferred from the local Budget. Measured in Phase 4a: seven hosted
 * searches arrived inside ONE SDK step, so any number derived from
 * `stepsUsed()` would have reported one. Every count here comes from the
 * provider's own output instead.
 *
 * Pure and free — no model, no network, no database.
 */
import { describe, expect, it } from 'vitest'
import { canonicalUrl, domainOf } from '@/lib/agent/research/url'
import { harvestSources, DEFAULT_HARVEST_LIMITS } from '@/lib/agent/research/harvest'
import { emptyResearchTelemetry, researchFailureReasonOf } from '@/lib/agent/research/telemetry'
import { providerSupportsHostedSearch } from '@/lib/agent/research/tool'
import { RESEARCH_DEADLINE_MS } from '@/lib/agent/research/admission'
import { DEFAULT_DEADLINE_MS } from '@/lib/agent/budget'

const AT = '2026-09-08T09:00:00.000Z'
const harvest = (sources: unknown[]) => harvestSources(sources as never, { retrievedAt: AT })

// ── canonical URL: deterministic, conservative ──────────────────────────────

describe('canonical URL merges the same page and nothing else', () => {
  it('is stable — the same input always gives the same output', () => {
    const u = 'https://www.Example.com/a/?b=2&a=1#frag'
    expect(canonicalUrl(u)).toBe(canonicalUrl(u))
  })

  it('merges www, trailing slash, default port, fragment and param order', () => {
    const forms = [
      'https://vendor.example/pricing',
      'https://www.vendor.example/pricing',
      'https://vendor.example/pricing/',
      'https://vendor.example:443/pricing',
      'https://vendor.example/pricing#section-2',
    ]
    const canon = forms.map((f) => canonicalUrl(f))
    expect(new Set(canon).size).toBe(1)
  })

  it('strips the provider\'s own attribution parameter', () => {
    // Measured verbatim in Phase 4a: the provider appended `?utm_source=openai`.
    expect(canonicalUrl('https://www.pipedrive.com/en/pricing?utm_source=openai')).toBe(
      canonicalUrl('https://www.pipedrive.com/en/pricing'),
    )
  })

  it('strips ad click ids', () => {
    for (const p of ['gclid=1', 'fbclid=2', 'msclkid=3', 'mc_cid=4']) {
      expect(canonicalUrl(`https://x.example/a?${p}`), p).toBe(canonicalUrl('https://x.example/a'))
    }
  })

  it('sorts remaining query params so order cannot split one page in two', () => {
    expect(canonicalUrl('https://x.example/a?b=2&a=1')).toBe(canonicalUrl('https://x.example/a?a=1&b=2'))
  })

  it('does NOT merge pages that differ in content-selecting params', () => {
    // The over-eager rule this guards against: dropping short opaque params.
    expect(canonicalUrl('https://x.example/post?id=1')).not.toBe(canonicalUrl('https://x.example/post?id=2'))
    expect(canonicalUrl('https://x.example/a')).not.toBe(canonicalUrl('https://x.example/b'))
    expect(canonicalUrl('https://a.example/x')).not.toBe(canonicalUrl('https://b.example/x'))
  })

  it('keeps hashbang routes apart, where the fragment IS the page', () => {
    expect(canonicalUrl('https://x.example/#!/a')).not.toBe(canonicalUrl('https://x.example/#!/b'))
  })

  it('keeps path case, which servers may treat as significant', () => {
    expect(canonicalUrl('https://x.example/A')).not.toBe(canonicalUrl('https://x.example/a'))
  })

  it('refuses anything that is not an http(s) page', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.example/a', 'not a url', '']) {
      expect(canonicalUrl(bad), bad).toBeNull()
    }
  })

  it('reports the publisher from the URL, never from content', () => {
    expect(domainOf('https://www.cio.com/article/1')).toBe('cio.com')
    expect(domainOf('nonsense')).toBeNull()
  })
})

// ── searched vs usable: the counts must stay distinguishable ────────────────

describe('harvest reports raw, unique, admitted and rejected separately', () => {
  it('zero sources — an empty result is not an error, and not a success', () => {
    const h = harvest([])
    expect(h).toMatchObject({ rawRecords: 0, unique: 0, cappedOut: 0, unusable: 0 })
    expect(h.refs).toHaveLength(0)
    expect(h.byDomain).toEqual({})
  })

  it('one source', () => {
    const h = harvest([{ url: 'https://a.example/1', title: 'A' }])
    expect(h).toMatchObject({ rawRecords: 1, unique: 1, cappedOut: 0, unusable: 0 })
    expect(h.byDomain).toEqual({ 'a.example': 1 })
  })

  it('the same URL returned by several searches counts once', () => {
    const h = harvest([
      { url: 'https://a.example/p' },
      { url: 'https://www.a.example/p/' },
      { url: 'https://a.example/p?utm_source=openai' },
    ])
    expect(h.rawRecords).toBe(3)
    expect(h.unique).toBe(1)
    expect(h.refs).toHaveLength(1)
  })

  it('separates unusable records from capped ones', () => {
    const h = harvest([{ url: 'javascript:alert(1)' }, { url: '' }, { url: 'https://a.example/1' }])
    expect(h).toMatchObject({ rawRecords: 3, unusable: 2, unique: 1, cappedOut: 0 })
  })

  it('a partial harvest — some usable, some not — keeps what it can', () => {
    const h = harvest([{ url: 'https://a.example/1' }, { url: 'data:text/html,x' }, { url: 'https://b.example/2' }])
    expect(h.refs).toHaveLength(2)
    expect(h).toMatchObject({ unusable: 1, unique: 2 })
  })

  it('counts multiple domains, and reports concentration without scoring it', () => {
    const h = harvest([
      { url: 'https://a.example/1' },
      { url: 'https://a.example/2' },
      { url: 'https://b.example/1' },
    ])
    expect(h.byDomain).toEqual({ 'a.example': 2, 'b.example': 1 })
    // No score, no ranking, no authority field anywhere on the ref.
    expect(Object.keys(h.refs[0]!)).not.toContain('trustScore')
  })

  it('caps are REAL AFTER dedupe — twenty records of one page admit one', () => {
    const dupes = Array.from({ length: 20 }, () => ({ url: 'https://a.example/p' }))
    const h = harvest(dupes)
    expect(h.rawRecords).toBe(20)
    expect(h.unique).toBe(1)
    expect(h.refs).toHaveLength(1)
    // Duplicates are not "capped out" — they were never distinct pages.
    expect(h.cappedOut).toBe(0)
  })

  it('caps total distinct sources', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://d${i}.example/p` }))
    const h = harvest(many)
    expect(h.refs).toHaveLength(DEFAULT_HARVEST_LIMITS.maxSources)
    expect(h.unique).toBe(20)
    expect(h.cappedOut).toBe(20 - DEFAULT_HARVEST_LIMITS.maxSources)
  })

  it('caps per publisher after dedupe, not before', () => {
    const h = harvest([
      { url: 'https://v.example/a' },
      { url: 'https://www.v.example/a/' }, // same page
      { url: 'https://v.example/b' },
      { url: 'https://v.example/c' }, // third distinct page from one publisher
    ])
    expect(h.unique).toBe(3)
    expect(h.refs).toHaveLength(DEFAULT_HARVEST_LIMITS.maxPerDomain)
    expect(h.cappedOut).toBe(1)
  })
})

describe('citation integrity survives normalization', () => {
  it('keeps the provider\'s original URL on the ref, not the canonical form', () => {
    // A rewritten address in a citation points at a page nobody visited.
    const original = 'https://www.pipedrive.com/en/pricing?utm_source=openai'
    const h = harvest([{ url: original, title: 'Pricing' }])
    expect(h.refs[0]!.url).toBe(original)
    expect(h.refs[0]!.url).not.toBe(canonicalUrl(original))
  })

  it('carries a publisher only when the provider supplies one', () => {
    expect(harvest([{ url: 'https://a.example/1' }]).refs[0]!.publisher).toBeUndefined()
    expect(harvest([{ url: 'https://a.example/1', publisher: 'CIO' }]).refs[0]!.publisher).toBe('CIO')
  })
})

// ── failure reasons: each outcome distinguishable ───────────────────────────

describe('research failure reasons name the earliest real cause', () => {
  const base = {
    researchRequested: true,
    researchAdmitted: true,
    hostedSearchCalls: 1,
    rawSourceRecords: 1,
    admittedSources: 1,
  }

  it('returns null when research actually worked', () => {
    expect(researchFailureReasonOf(base)).toBeNull()
  })

  it('distinguishes every failure mode', () => {
    expect(researchFailureReasonOf({ ...base, researchRequested: false })).toBe('not-requested')
    expect(researchFailureReasonOf({ ...base, researchAdmitted: false })).toBe('provider-unsupported')
    expect(researchFailureReasonOf({ ...base, providerError: true })).toBe('provider-error')
    expect(researchFailureReasonOf({ ...base, timedOut: true })).toBe('deadline')
    expect(researchFailureReasonOf({ ...base, hostedSearchCalls: 0 })).toBe('no-searches')
    expect(researchFailureReasonOf({ ...base, rawSourceRecords: 0 })).toBe('no-sources')
    expect(researchFailureReasonOf({ ...base, admittedSources: 0 })).toBe('no-usable-sources')
  })

  it('blames the earliest cause, not the last symptom', () => {
    // Never admitted ⇒ no searches is a CONSEQUENCE, not the reason.
    expect(
      researchFailureReasonOf({ ...base, researchAdmitted: false, hostedSearchCalls: 0, rawSourceRecords: 0, admittedSources: 0 }),
    ).toBe('provider-unsupported')
  })

  it('keeps "searched and found nothing" apart from "never searched"', () => {
    expect(researchFailureReasonOf({ ...base, hostedSearchCalls: 3, rawSourceRecords: 0 })).toBe('no-sources')
    expect(researchFailureReasonOf({ ...base, hostedSearchCalls: 0, rawSourceRecords: 0 })).toBe('no-searches')
  })
})

// ── bounds ──────────────────────────────────────────────────────────────────

describe('research bounds stay separate from the CRM ones', () => {
  it('keeps the research deadline longer than the CRM one, but inside the route limit (F4)', () => {
    // Was 90s — past the route's 60s maxDuration, so the platform, not the
    // application, ended slow research runs. See deadline.test.ts.
    expect(RESEARCH_DEADLINE_MS).toBe(45_000)
    expect(RESEARCH_DEADLINE_MS).toBeGreaterThan(DEFAULT_DEADLINE_MS)
    expect(RESEARCH_DEADLINE_MS).toBeLessThan(60_000)
  })

  it('leaves the CRM deadline at 40s', () => {
    expect(DEFAULT_DEADLINE_MS).toBe(40_000)
  })

  it('starts telemetry at the run\'s own deadline, with nothing assumed', () => {
    const t = emptyResearchTelemetry(RESEARCH_DEADLINE_MS)
    expect(t).toMatchObject({
      researchRequested: false,
      researchAdmitted: false,
      hostedSearchCalls: 0,
      researchDeadlineMs: RESEARCH_DEADLINE_MS,
      researchFailureReason: 'not-requested',
    })
  })
})

describe('the hosted tool is admitted only where it can actually run', () => {
  it('admits OpenAI, which owns the hosted tool', () => {
    expect(providerSupportsHostedSearch('openai')).toBe(true)
  })

  it('refuses a failed-over provider rather than sending it a malformed tool', () => {
    for (const p of ['anthropic', 'google', 'unknown']) {
      expect(providerSupportsHostedSearch(p), p).toBe(false)
    }
  })
})
