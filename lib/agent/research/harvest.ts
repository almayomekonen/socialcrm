import { canonicalUrl, domainOf } from './url'
import type { EvidenceRef } from '../types'

/**
 * Provider output → citable evidence. PURE, and the only place a source is minted.
 *
 * WHY THIS EXISTS AT ALL. Hosted web search is PROVIDER-EXECUTED: it never runs
 * our code, so it never reaches `budget.canStep()` and never writes to the
 * EvidenceCollector the way our nine CRM tools do from inside their `execute`.
 * Without a harvest every SOURCED claim would be destroyed as
 * `no-valid-evidence`, and the honest-looking failure would be an agent that
 * searched the web and then refused to say anything about it.
 *
 * MEASURED BEHAVIOUR (2026-09-08, gpt-5.6, ai@6.0.176 / @ai-sdk/openai@3.0.63),
 * because every bound below is derived from it rather than guessed:
 *
 *   · Hosted calls DO NOT consume SDK steps. Seven `web_search` calls arrived
 *     inside `steps.length === 1`. `stepCountIs(n)` therefore bounds nothing
 *     here, which is why the wall clock is the real limit and why the caps in
 *     this file are the only bound on breadth.
 *   · They surface as `toolCalls`/`toolResults` with `providerExecuted: true`;
 *     local tools carry `providerExecuted: undefined`.
 *   · `result.sources` gives `{ type:'source', sourceType:'url', id, url, title }`.
 *     Per-result `output.sources` gives bare `{ type:'url', url }` with no title,
 *     and `output.action` is `{type:'search', query}` or `{type:'openPage', url}`.
 *   · `result.sources` CONTAINS DUPLICATES — six entries over three distinct URLs
 *     in one run — so deduping is required, not defensive.
 *   · Latency: 33.8s for one topic, 72.9s for a two-company comparison.
 *
 * THREE SURFACES, TWO OF WHICH ARE EVIDENCE (Phase 4e, measured in
 * `__tests__/ai/agent/research/providerShape.test.ts`):
 *
 *   DISCOVERED  `action.sources` on a search action — 12-20 engine hits per
 *               call, `{type,url}`, no title. NEVER ADMITTED. These are results
 *               the model may never have opened; citing one would assert a
 *               source for a page nobody read.
 *   OPENED      `action.url` on an `openPage` action — the page the provider
 *               actually fetched. ADMITTED. The model read it; that is a
 *               stronger fact than a search engine listing it.
 *   CITED       `result.sources`, built from `url_citation` annotations on the
 *               answer text. ADMITTED, and the only one that also carries a
 *               title.
 *
 * WHY OPENED IS ADMISSIBLE AT ALL. R01 of the research evaluation searched
 * twice, opened pages, cited nothing, and was refused as `no-sources` — the
 * agent had genuinely read the web and could say nothing about it. Citation is
 * the model's own attribution behaviour, not a record of what it consulted, so
 * resting grounding solely on it makes an answer's admissibility depend on
 * whether the model remembered to annotate. Opening is the provider's record of
 * a fetch, and it is the thing that actually happened.
 *
 * A SOURCE MAY THEREFORE BE GROUNDED WITHOUT BEING CITED. `opened` and `cited`
 * are carried on the ref for telemetry and for a citation UI that may want to
 * distinguish them; neither changes what a SOURCED claim must do to survive
 * validation, which is unchanged.
 *
 * WHAT IS DELIBERATELY NOT KEPT: the retrieved page text. Persisting attacker-
 * controlled prose so it can be replayed into a later prompt is the injection
 * surface this whole phase is built to avoid. The model read the page during the
 * search; the citation is what survives.
 *
 * DEDUPLICATION IS ON CANONICAL FORM, CITATION IS ON THE ORIGINAL. `./url.ts`
 * answers "is this the same page?"; the ref keeps the URL the provider actually
 * fetched, because a rewritten address in a citation points at a page nobody
 * visited. The measured run that motivated this returned the same Pipedrive
 * pricing page twice, once carrying `?utm_source=openai`.
 */

/** The shape the AI SDK exposes on `result.sources`. Narrowed to what we use. */
export type ProviderSource = {
  sourceType?: string
  id?: string
  url?: string
  title?: string
  /** Not returned today. Carried through if a provider ever supplies one. */
  publisher?: string
}

export type HarvestLimits = {
  /** Total sources admitted into one investigation. */
  maxSources: number
  /** Sources admitted from any single publisher. */
  maxPerDomain: number
}

/**
 * Conservative, and set from the measurement above rather than from taste.
 *
 * Eight covers the widest run observed (seven distinct URLs) with one to spare,
 * so the cap bites only on a run already broader than anything measured. Two per
 * domain stops one publisher's site becoming "the market" — the failure mode
 * where four pages from a single vendor read as four independent confirmations.
 */
export const DEFAULT_HARVEST_LIMITS: HarvestLimits = { maxSources: 8, maxPerDomain: 2 }

export type HarvestResult = {
  refs: Extract<EvidenceRef, { kind: 'source' }>[]
  /** Source entries the provider returned, before anything was applied. */
  rawRecords: number
  /** Distinct pages after canonical deduplication. */
  unique: number
  /** Unique pages turned away by a cap. */
  cappedOut: number
  /** Entries that were not usable page addresses at all. */
  unusable: number
  /** Publisher → admitted count. Concentration, reported rather than scored. */
  byDomain: Record<string, number>
}

/**
 * Turn what the provider returned into evidence refs.
 *
 * ORDER IS THE PROVIDER'S. It ranked them; we do not re-rank, because any
 * ordering we invented would be an unearned relevance judgement presented to the
 * model as one.
 *
 * REFIDS ARE ASSIGNED HERE, sequentially — `src_1`, `src_2` — and are opaque on
 * purpose. The model can only cite an id it was given in a tool result, so an id
 * it could derive from a URL printed on a page would be an id it could invent.
 */
/**
 * The URLs the provider actually FETCHED, pulled from `openPage` actions.
 *
 * Pure and defensive: tool results are provider-shaped data, so every level is
 * checked rather than assumed. `find_in_page` carries a URL too but describes a
 * search WITHIN a page already opened, so admitting it would double-count the
 * same fetch; only `openPage` is read.
 *
 * `action.sources` is deliberately not touched here. Discovery is not evidence.
 */
export function openedPageUrls(toolResults: readonly unknown[] | undefined): string[] {
  const urls: string[] = []
  for (const entry of toolResults ?? []) {
    const rec = (entry ?? {}) as Record<string, unknown>
    const output = (rec.output ?? rec.result ?? {}) as Record<string, unknown>
    const action = (output.action ?? {}) as Record<string, unknown>
    if (action.type !== 'openPage') continue
    const url = typeof action.url === 'string' ? action.url.trim() : ''
    if (url) urls.push(url)
  }
  return urls
}

/** One candidate page, and which channel it arrived on. */
type Candidate = { url: string; title?: string; publisher?: string; cited: boolean; opened: boolean }

export function harvestSources(
  provided: readonly ProviderSource[] | undefined,
  opts: { retrievedAt: string; limits?: HarvestLimits; opened?: readonly string[] },
): HarvestResult {
  const limits = opts.limits ?? DEFAULT_HARVEST_LIMITS
  const refs: Extract<EvidenceRef, { kind: 'source' }>[] = []
  const perDomain = new Map<string, number>()
  const byDomain: Record<string, number> = {}
  let rawRecords = 0
  let unique = 0
  let cappedOut = 0
  let unusable = 0

  /**
   * CITED FIRST, THEN OPENED. Both are admissible, but a citation carries a
   * title and an opened URL does not, so when the same page arrives on both
   * channels the cited record wins the identity and the opened flag is merged
   * onto it. Within each channel the provider's order is preserved: it ranked
   * them, and any re-ranking here would be an unearned relevance judgement.
   */
  const candidates: Candidate[] = [
    ...(provided ?? []).map((s) => ({
      url: typeof s?.url === 'string' ? s.url.trim() : '',
      title: typeof s?.title === 'string' ? s.title : undefined,
      publisher: typeof s?.publisher === 'string' ? s.publisher : undefined,
      cited: true,
      opened: false,
    })),
    ...(opts.opened ?? []).map((url) => ({ url: typeof url === 'string' ? url.trim() : '', cited: false, opened: true })),
  ]

  /**
   * Grouped BEFORE the caps are applied, so a page opened and then cited is one
   * source carrying both flags rather than two competing for one slot. Insertion
   * order is kept, which is what the caps then walk.
   */
  const byCanonical = new Map<string, { candidate: Candidate; domain: string }>()

  for (const c of candidates) {
    rawRecords++
    // `canonicalUrl` is the single usability test: it returns null for an empty
    // string, a malformed URL, and any non-http(s) scheme — a `javascript:` or
    // `data:` "source" is not a page anyone read.
    const canonical = c.url ? canonicalUrl(c.url) : null
    const domain = c.url ? domainOf(c.url) : null
    if (!canonical || !domain) {
      unusable++
      continue
    }
    const existing = byCanonical.get(canonical)
    if (existing) {
      // Same page, other channel: merge provenance, keep the first identity.
      existing.candidate.cited ||= c.cited
      existing.candidate.opened ||= c.opened
      continue
    }
    byCanonical.set(canonical, { candidate: { ...c }, domain })
    unique++
  }

  for (const { candidate, domain } of byCanonical.values()) {
    if (refs.length >= limits.maxSources) {
      cappedOut++
      continue
    }
    const used = perDomain.get(domain) ?? 0
    if (used >= limits.maxPerDomain) {
      cappedOut++
      continue
    }
    perDomain.set(domain, used + 1)
    byDomain[domain] = (byDomain[domain] ?? 0) + 1

    refs.push({
      kind: 'source',
      refId: `src_${refs.length + 1}`,
      // THE PROVIDER'S OWN URL, not the canonical one — this is what a reader opens.
      url: candidate.url,
      // A missing title is the domain rather than an empty string: a citation
      // with no label is unreadable, and the domain is always true. An opened
      // page has no title at all, so this is its normal state.
      title: candidate.title && candidate.title.trim() ? candidate.title.trim() : domain,
      domain,
      // Only if the provider actually gave one. Never derived from the title.
      ...(candidate.publisher && candidate.publisher.trim() ? { publisher: candidate.publisher.trim() } : {}),
      // Provenance, for telemetry and for a UI that may distinguish them. Neither
      // flag changes what a SOURCED claim must do to survive validation.
      opened: candidate.opened,
      cited: candidate.cited,
      retrievedAt: opts.retrievedAt,
    })
  }

  return { refs, rawRecords, unique, cappedOut, unusable, byDomain }
}

/**
 * What Phase 2 is told it may cite.
 *
 * WITHOUT THIS THE MODEL CANNOT CITE ANYTHING. The refIds are minted here, in
 * our code, after the search returned — they appear nowhere in the tool results
 * the model saw, so a research answer would name URLs it read, fail to resolve
 * them, and be destroyed as unsupported. This is the same contract the CRM tools
 * meet by emitting `evidenceRef` beside every id; hosted search cannot, so the
 * manifest does it for them.
 *
 * URL AND DOMAIN ONLY — deliberately not the page title. The title is
 * attacker-controlled text, and every string reproduced into the prompt is a
 * line an author of a hostile page got to write. The model already read the page
 * during the search; the manifest exists to map ids to pages, not to carry their
 * content. Titles stay on the evidence ref for the citation UI, where they are
 * rendered as text and never interpreted.
 *
 * Framed explicitly as OUR instruction, in the system voice, so the ids cannot
 * be mistaken for something a page asserted.
 */
export function sourceManifest(evidence: { sources(): { refId: string; url: string; domain: string }[] }) {
  const sources = evidence.sources()
  if (sources.length === 0) return []
  const lines = sources.map((s) => `${s.refId} = ${s.domain} (${s.url})`).join('\n')
  return [
    {
      role: 'system' as const,
      content:
        'מזהי המקורות שנאספו בחיפוש הזה. רק המזהים האלה תקפים ל-sourceEvidence, ' +
        'ואסור להמציא מזהה או לצטט כתובת URL כמזהה:\n' +
        lines,
    },
  ]
}
