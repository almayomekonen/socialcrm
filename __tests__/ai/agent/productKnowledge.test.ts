/**
 * Phase 1 — the agent's second knowledge domain.
 *
 * The agent could only answer from CRM evidence, so a question about SocialCRM
 * itself was answered as though it were a question about the customer's rows:
 * "למה המערכת הזו טובה?" returned "לא מצאתי מספיק נתונים". These pin the domain
 * split, and — more importantly — pin that adding it did not buy the model a way
 * to assert business numbers without evidence.
 */
import { describe, expect, it } from 'vitest'
import {
  PRODUCT_TOPICS,
  getProductTopic,
  isProductTopic,
  productKnowledgeIndex,
} from '@/lib/agent/product/knowledge'
import { globSync } from 'node:fs'
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt'
import { PRICING, TRIAL_OFFER_FAQ_ANSWER } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { validateAgentAnswer, validateAgentAnswerDetailed } from '@/lib/agent/validate'
import type { AgentAnswer } from '@/lib/agent/types'

const empty = () => createEvidenceCollector()

function withCrm() {
  const e = createEvidenceCollector()
  e.add({ kind: 'lead', refId: '161' })
  e.add({ kind: 'metric', metric: 'today.total', window: { from: 'T0', to: 'T0' }, n: 5 })
  return e
}

const answer = (claims: AgentAnswer['claims'], unknown: string | null = null): AgentAnswer => ({
  headline: 'כותרת',
  claims,
  unknown,
})

// ─── The knowledge itself ───────────────────────────────────────────────────

describe('canonical product knowledge', () => {
  it('every topic carries a title, substantive summary and a repo source', () => {
    for (const t of PRODUCT_TOPICS) {
      expect(t.title.trim().length, t.id).toBeGreaterThan(0)
      expect(t.summary.trim().length, t.id).toBeGreaterThan(60)
      // The source is what makes a claim auditable rather than asserted.
      expect(t.source.trim().length, t.id).toBeGreaterThan(0)
    }
  })

  it('states what the product does NOT do, so limits are answerable too', () => {
    const limits = getProductTopic('not_supported')
    expect(limits).toBeTruthy()
    // Conversion rate and revenue are the two the live run had to refuse.
    expect(limits!.summary).toMatch(/המרה/)
    expect(limits!.summary).toMatch(/הכנס/)
  })

  it('never uses the insurance term for a person', () => {
    // `סוכן` is banned as a word for a REP (ux-guidelines §6) — `נציג` is the
    // product's word. It is legitimate only where it names this feature, which
    // the product itself calls "הסוכן שלך"; those two topics are the exception,
    // and every other topic must be clean.
    const namesTheAgent = new Set(['the_agent', 'not_supported', 'recent_updates'])
    for (const t of PRODUCT_TOPICS) {
      if (namesTheAgent.has(t.id)) continue
      expect(t.summary, t.id).not.toMatch(/סוכן/)
    }
    // And nowhere does it call a person one.
    for (const t of PRODUCT_TOPICS) expect(t.summary, t.id).not.toMatch(/הסוכן ש(לו|לה|להם)/)
  })

  it('quotes the price and the trial from their single source, never a retyped figure', () => {
    const pricing = getProductTopic('pricing_trial')!.summary
    expect(pricing).toContain(TRIAL_OFFER_FAQ_ANSWER)
    expect(pricing).toContain(`${PRICING.currency}${PRICING.monthly}`)
    expect(pricing).toContain(`${TRIAL_LENGTH_DAYS} ימי`)
  })

  it('no longer claims the product has no revenue report, or that the agent never acts', () => {
    // Performance shows paid revenue (db/helpers/sum_helpers.ts saleStats); the agent proposes tasks, follow-ups and meetings.
    expect(getProductTopic('not_supported')!.summary).not.toMatch(/אין כרגע דוח המרות או דוח הכנסות/)
    expect(getProductTopic('not_supported')!.summary).toMatch(/ביצועים/)
    expect(getProductTopic('the_agent')!.summary).not.toMatch(/לא מבצע פעולות/)
    expect(getProductTopic('deals_and_performance')!.summary).toMatch(/ששולמו/)
  })

  it('says so wherever a feature is switched on per account', () => {
    // The index is the same for every tenant: a flag-gated feature must not read as one every owner has.
    for (const id of ['automations', 'auto_reply', 'whatsapp_questionnaire', 'messenger', 'facebook_comments', 'meta_ads', 'recent_updates']) {
      expect(getProductTopic(id)!.summary, id).toMatch(/לחשבונות שנבחרו/)
    }
  })

  it('every route a topic names is a real page in the app', () => {
    const pages = globSync('app/**/page.tsx').map((f) => '/' + f.replace(/\\/g, '/').split('/').slice(1, -1).filter((seg) => !/^\(.*\)$/.test(seg)).join('/'))
    for (const t of PRODUCT_TOPICS) {
      for (const route of t.routes ?? []) expect(pages, `${t.id} ${route}`).toContain(route.split('?')[0])
    }
  })

  it('a topic links only a screen it names, and a topic naming several screens says which one it is about', () => {
    for (const t of PRODUCT_TOPICS) {
      if (t.link) expect(t.routes ?? [], t.id).toContain(t.link)
    }
    // The four without a link span several screens with no single subject; a reply citing them links nothing.
    expect(PRODUCT_TOPICS.filter((t) => (t.routes?.length ?? 0) > 0 && !t.link).map((t) => t.id).sort()).toEqual(['getting_started', 'tasks_followups', 'team', 'today_and_performance'])
  })

  it('exposes an index compact enough to sit in a prompt', () => {
    const index = productKnowledgeIndex()
    expect(index).toContain('core_value')
    expect(index).toContain('getting_started')
    // Architecture, not a 5,000-line prompt: the index is an index.
    expect(index.split('\n').length).toBeLessThan(60)
  })
})

// ─── The prompt routes by domain ────────────────────────────────────────────

describe('the agent identity routes questions to a source', () => {
  it('is a business partner, not a CRM investigator', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/שותף העסקי/)
  })

  it('tells the model not to force every question through CRM tools', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אל תכריח כל שאלה דרך כלי CRM/)
  })

  it('carries the product index, so a product question needs no tool call', () => {
    expect(AGENT_SYSTEM_PROMPT).toContain('core_value')
    expect(AGENT_SYSTEM_PROMPT).toContain('getting_started')
  })

  it('still demands CRM evidence for business facts', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/כל עובדה מגיעה מכלי שקראת לו עכשיו/)
  })
})

// ─── Product claims validate against the registry ───────────────────────────

describe('a PRODUCT claim is grounded in the registry, not in CRM evidence', () => {
  const product = (refs: string[]) =>
    answer([{ claimClass: 'PRODUCT', text: 'SocialCRM מרכזת לידים ושיחות במקום אחד.', productEvidence: refs }])

  it('survives with NO CRM evidence at all', () => {
    // The exact failure this phase fixes.
    expect(validateAgentAnswer(product(['core_value']), empty())).not.toBeNull()
  })

  it('is refused when it cites a topic that does not exist', () => {
    expect(validateAgentAnswer(product(['invented_feature']), empty())).toBeNull()
    expect(isProductTopic('invented_feature')).toBe(false)
  })

  it('every topic is citable: a product answer on any of them survives with no CRM evidence (web Agent and WhatsApp alike)', () => {
    for (const t of PRODUCT_TOPICS) expect(validateAgentAnswer(product([t.id]), empty()), t.id).not.toBeNull()
  })

  it('a casual reply with no claims passes the shared validator on the interactive path, so the web panel shows it', () => {
    const casual: AgentAnswer = { headline: 'תודה, כיף לשמוע.', claims: [], unknown: null }
    expect(validateAgentAnswer(casual, empty())?.headline).toBe('תודה, כיף לשמוע.')
    // The autonomous path still refuses an answer asserting nothing.
    expect(validateAgentAnswerDetailed(casual, empty(), { requireClaim: true }).rejection).toBe('no-supportable-claim')
  })

  it('cannot be grounded by a lead or a metric', () => {
    expect(validateAgentAnswer(product(['161']), withCrm())).toBeNull()
    expect(validateAgentAnswer(product(['today.total']), withCrm())).toBeNull()
  })

  it('a topic id cannot ground a CRM FACT', () => {
    // The reverse direction: product knowledge must not launder a business claim.
    const laundered = answer([
      { claimClass: 'FACT', text: 'יש לך 5 לידים שמחכים.', entityEvidence: ['core_value'] },
    ])
    expect(validateAgentAnswer(laundered, withCrm())).toBeNull()
  })
})

// ─── Grounding for CRM facts is untouched ───────────────────────────────────

describe('CRM grounding did not weaken', () => {
  it('an unsupported CRM fact is still rejected', () => {
    expect(
      validateAgentAnswer(answer([{ claimClass: 'FACT', text: 'יוסי מחכה 14 שעות.', entityEvidence: ['999'] }]), withCrm()),
    ).toBeNull()
  })

  it('a recommendation resting on real CRM evidence survives', () => {
    const v = validateAgentAnswer(
      answer([
        { claimClass: 'FACT', text: '5 לידים מחכים למענה.', entityEvidence: ['161'] },
        { claimClass: 'RECOMMENDATION', text: 'הייתי מתחיל בדוד.', evidence: ['161'] },
      ]),
      withCrm(),
    )
    expect(v?.claims).toHaveLength(2)
    expect(v?.claims.map((c) => c.claimClass)).toEqual(['FACT', 'RECOMMENDATION'])
  })

  it('a mixed answer keeps product and CRM claims side by side', () => {
    const v = validateAgentAnswer(
      answer([
        { claimClass: 'PRODUCT', text: 'המערכת מרכזת לידים במקום אחד.', productEvidence: ['core_value'] },
        { claimClass: 'FACT', text: 'דוד ממתין למענה.', entityEvidence: ['161'] },
      ]),
      withCrm(),
    )
    expect(v?.claims).toHaveLength(2)
  })
})

// ─── Honest unknown, and the autonomous exception ───────────────────────────

describe('an honest unknown is an answer, not a failure', () => {
  it('an answer that is only an unknown survives', () => {
    const v = validateAgentAnswer(answer([], 'אין לי נתון שמאפשר לחשב שיעור המרה.'), empty())
    expect(v).not.toBeNull()
    expect(v!.unknown).toMatch(/שיעור המרה/)
  })

  it('a greeting with nothing to claim survives', () => {
    expect(validateAgentAnswer(answer([]), empty())).not.toBeNull()
  })

  it('but an answer whose claims were ALL destroyed is still refused', () => {
    // The protective rule, unchanged: something unsupported was proposed.
    const v = validateAgentAnswerDetailed(
      answer([{ claimClass: 'FACT', text: 'שיעור ההמרה שלך 18%.', entityEvidence: ['999'] }]),
      withCrm(),
    )
    expect(v.answer).toBeNull()
    expect(v.rejection).toBe('no-supportable-claim')
  })

  it('the autonomous path still refuses a claimless finding', () => {
    const v = validateAgentAnswerDetailed(answer([], 'לא מצאתי כלום.'), withCrm(), { requireClaim: true })
    expect(v.answer).toBeNull()
  })
})
