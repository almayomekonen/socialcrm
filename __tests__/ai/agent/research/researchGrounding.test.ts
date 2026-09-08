/**
 * External evidence, end to end through the EXISTING pipeline.
 *
 * The property under test is that research changed nothing about how trust
 * works: a source becomes evidence only by being harvested from what the
 * provider actually returned, a claim survives only by citing evidence that is
 * there, and everything the validator did before it still does.
 *
 * Deterministic and free — no model, no network, no database. The provider's
 * output shape is a fixture taken from a real measured run (see harvest.ts).
 */
import { describe, expect, it } from 'vitest'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { harvestSources, DEFAULT_HARVEST_LIMITS } from '@/lib/agent/research/harvest'
import { admitsResearch } from '@/lib/agent/research/admission'
import { validateAgentAnswerDetailed } from '@/lib/agent/validate'
import type { AgentAnswer, Claim } from '@/lib/agent/types'

const AT = '2026-09-08T09:00:00.000Z'

/** Verbatim shape from the measured run: duplicates included, on purpose. */
const PROVIDER_SOURCES = [
  { type: 'source', sourceType: 'url', id: 'S4oZ', url: 'https://www.pipedrive.com/en/pricing', title: 'CRM Pricing Plans | Pipedrive' },
  { type: 'source', sourceType: 'url', id: 'A1b2', url: 'https://www.hubspot.com/pricing/sales', title: 'HubSpot Sales Pricing' },
  { type: 'source', sourceType: 'url', id: 'S4oZ', url: 'https://www.pipedrive.com/en/pricing', title: 'CRM Pricing Plans | Pipedrive' },
]

function harvestedInto(sources: unknown[] = PROVIDER_SOURCES) {
  const e = createEvidenceCollector()
  const h = harvestSources(sources as never, { retrievedAt: AT })
  for (const ref of h.refs) e.add(ref)
  return { evidence: e, harvest: h }
}

const answer = (claims: Claim[]): AgentAnswer => ({
  headline: 'מחירי CRM לעסקים קטנים.',
  claims,
  unknown: null,
})

// ── B/C · a real source becomes citable evidence ────────────────────────────

describe('provider output becomes evidence', () => {
  it('mints one ref per distinct URL, keeping the provider order', () => {
    const { harvest } = harvestedInto()
    expect(harvest.refs.map((r) => r.url)).toEqual([
      'https://www.pipedrive.com/en/pricing',
      'https://www.hubspot.com/pricing/sales',
    ])
    expect(harvest.refs[0]).toMatchObject({ kind: 'source', refId: 'src_1', domain: 'pipedrive.com', retrievedAt: AT })
  })

  it('deduplicates the repeated page rather than counting it twice', () => {
    // Measured: six entries over three URLs in one run. Two refs citing one page
    // would let a claim look twice-supported.
    const { evidence, harvest } = harvestedInto()
    expect(harvest.rawRecords).toBe(3)
    expect(harvest.unique).toBe(2)
    expect(evidence.sources()).toHaveLength(2)
  })

  it('derives the publisher from the URL, never from the title', () => {
    const { harvest } = harvestedInto([
      { url: 'https://www.example.co.il/a', title: 'Official HubSpot Announcement' },
    ])
    expect(harvest.refs[0]!.domain).toBe('example.co.il')
  })

  it('refuses a non-http source', () => {
    const { harvest } = harvestedInto([{ url: 'javascript:alert(1)', title: 'x' }, { url: 'data:text/html,x' }])
    expect(harvest.refs).toHaveLength(0)
  })

  it('falls back to the domain when a title is missing, never to an empty label', () => {
    const { harvest } = harvestedInto([{ url: 'https://news.example/x' }])
    expect(harvest.refs[0]!.title).toBe('news.example')
  })
})

describe('harvest caps bound breadth we cannot otherwise bound', () => {
  it('caps total sources', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://d${i}.example/p`, title: `t${i}` }))
    const { harvest } = harvestedInto(many)
    expect(harvest.refs).toHaveLength(DEFAULT_HARVEST_LIMITS.maxSources)
    expect(harvest.cappedOut).toBe(20 - DEFAULT_HARVEST_LIMITS.maxSources)
  })

  it('caps per publisher, so one site cannot become "the market"', () => {
    const oneSite = Array.from({ length: 5 }, (_, i) => ({ url: `https://vendor.example/p${i}`, title: `p${i}` }))
    const { harvest } = harvestedInto(oneSite)
    expect(harvest.refs).toHaveLength(DEFAULT_HARVEST_LIMITS.maxPerDomain)
  })

  it('treats www and bare host as one publisher', () => {
    const { harvest } = harvestedInto([
      { url: 'https://www.vendor.example/a' },
      { url: 'https://vendor.example/b' },
      { url: 'https://vendor.example/c' },
    ])
    expect(harvest.refs).toHaveLength(2)
  })
})

// ── C · the claim survives validation ───────────────────────────────────────

describe('a SOURCED claim grounded in a harvested source survives', () => {
  it('keeps the claim and its citation', () => {
    const { evidence } = harvestedInto()
    const v = validateAgentAnswerDetailed(
      answer([{ claimClass: 'SOURCED', text: 'לפי Pipedrive, תוכניות נכנסות מתחילות ב-$14.', sourceEvidence: ['src_1'] }]),
      evidence,
    )
    expect(v.answer?.claims).toHaveLength(1)
    expect(v.answer?.claims[0]).toMatchObject({ claimClass: 'SOURCED', sourceEvidence: ['src_1'] })
  })
})

// ── D/E · missing and fabricated evidence ───────────────────────────────────

describe('unsupported external claims cannot ship', () => {
  it('drops a claim citing a source id that was never harvested', () => {
    const { evidence } = harvestedInto()
    const v = validateAgentAnswerDetailed(
      answer([{ claimClass: 'SOURCED', text: 'לפי מקור כלשהו, המחירים עלו.', sourceEvidence: ['src_99'] }]),
      evidence,
    )
    expect(v.answer).toBeNull()
    expect(v.rejection).toBe('no-supportable-claim')
  })

  it('drops a claim citing a URL instead of a ref id', () => {
    // The model may see URLs in the search output; they are not citations.
    const { evidence } = harvestedInto()
    const v = validateAgentAnswerDetailed(
      answer([{ claimClass: 'SOURCED', text: 'לפי האתר.', sourceEvidence: ['https://www.pipedrive.com/en/pricing'] }]),
      evidence,
    )
    expect(v.answer).toBeNull()
  })

  // F · a failed or empty search must not become a confident answer.
  it('grounds nothing when the search returned no sources', () => {
    const { evidence, harvest } = harvestedInto([])
    expect(harvest.refs).toHaveLength(0)
    const v = validateAgentAnswerDetailed(
      answer([{ claimClass: 'SOURCED', text: 'לפי מחקר שוק, הביקוש עולה.', sourceEvidence: ['src_1'] }]),
      evidence,
    )
    expect(v.answer).toBeNull()
  })
})

// ── the class boundary that keeps external out of internal ──────────────────

describe('external evidence cannot masquerade as internal', () => {
  it('refuses a FACT grounded on a source', () => {
    // "A competitor raised prices" must never wear the badge that means
    // "this is a row in your database".
    const { evidence } = harvestedInto()
    const v = validateAgentAnswerDetailed(
      answer([{ claimClass: 'FACT', text: 'מתחרה העלה מחירים.', entityEvidence: ['src_1'] }]),
      evidence,
    )
    expect(v.answer).toBeNull()
  })

  it('refuses an OBSERVATION grounded on a source', () => {
    const { evidence } = harvestedInto()
    const v = validateAgentAnswerDetailed(
      answer([{ claimClass: 'OBSERVATION', text: 'הביקוש ירד ב-12%.', metricEvidence: ['src_1'] }]),
      evidence,
    )
    expect(v.answer).toBeNull()
  })

  it('lets an INFERENCE join internal to external — hedged', () => {
    const { evidence } = harvestedInto()
    evidence.add({ kind: 'lead', refId: '161' })
    const v = validateAgentAnswerDetailed(
      answer([{ claimClass: 'INFERENCE', text: 'ייתכן שהשינוי בשוק קשור לירידה אצלך.', evidence: ['src_1', 'lead:161'] }]),
      evidence,
    )
    expect(v.answer?.claims).toHaveLength(1)
  })

  it('still refuses that inference when it is not hedged', () => {
    const { evidence } = harvestedInto()
    const v = validateAgentAnswerDetailed(
      answer([{ claimClass: 'INFERENCE', text: 'השוק גרם לירידה בלידים שלך.', evidence: ['src_1'] }]),
      evidence,
    )
    expect(v.answer).toBeNull()
  })
})

// ── A · routing. A CRM question never receives the tool ─────────────────────

describe('admission fails closed', () => {
  const crmQuestions = [
    'מי דורש ממני טיפול היום?',
    'מה קורה בעסק שלי עכשיו?',
    'תראה לי לידים שלא קיבלו מענה',
    'מי הליד הכי חשוב לטפל בו עכשיו?',
    'כמה לידים יש לי?',
    'מה הבעיה הכי גדולה שלי כרגע?',
    'תמצא לי הזדמנות.',
    'אילו משימות באיחור יש לי?',
    'איך מחברים וואטסאפ?',
    'מה המגמות שלי בחודש האחרון?',
  ]

  it.each(crmQuestions)('does not admit research for: %s', (q) => {
    expect(admitsResearch(q).admitted).toBe(false)
  })

  const researchQuestions = [
    'מה קורה בשוק שלנו השנה?',
    'מה המגמות בענף עכשיו?',
    'תחפש מה כתוב על התחום הזה',
    'what are the market trends for CRM in 2026?',
  ]

  it.each(researchQuestions)('admits research for: %s', (q) => {
    expect(admitsResearch(q).admitted).toBe(true)
  })

  it('admits nothing for an empty question', () => {
    expect(admitsResearch('').admitted).toBe(false)
    expect(admitsResearch(undefined).admitted).toBe(false)
  })

  it('reports the marker for the trace, never the question', () => {
    const a = admitsResearch('מה קורה בשוק?')
    expect(a.marker).toBe('שוק')
  })
})
