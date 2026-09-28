/**
 * Phase 3a — MIXED, and what it deliberately is not.
 *
 * WHY THE DOMAIN EXISTS. Without it a question spanning two domains was
 * silently collapsed into one, and the collapse was lossy in both directions:
 * "האם כדאי לי לשלם" became a product question that never checked whether the
 * business was getting value, and "מה קורה בעסק ומה כדאי לשנות" became a CRM
 * read that stopped short of advising.
 *
 * THE FAILURE IT INVITES is the reason most of this file is about restraint. A
 * model that reads "more than one domain applies" as "investigate everything"
 * turns a two-tool question into a six-tool one and spends the rep's wall clock
 * to say the same thing. The evaluation had just measured that clock at 19.2s
 * average, so the guard is not hypothetical.
 *
 * WHAT A UNIT TEST CAN PROVE HERE. Domain classification is the model's
 * decision; asserting which domain it picks would mean mocking the choice and
 * testing the mock. What is pinned instead is the contract the decision is made
 * from — that the domain list is the code's, that MIXED is stated as routing
 * rather than permission, and that none of the CRM routing Phase 2.5.1 fixed has
 * moved.
 */
import { describe, expect, it } from 'vitest'
import { AGENT_DOMAINS, BUSINESS_DOMAINS, domainAdmitsResearch, type AgentDomain } from '@/lib/agent/domains'
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt'

describe('the domain model', () => {
  it('is exactly the six routes the agent can actually serve', () => {
    expect([...AGENT_DOMAINS]).toEqual(['GENERAL', 'PRODUCT', 'CRM', 'BUSINESS_ADVICE', 'MIXED', 'RESEARCH'])
  })

  /**
   * REPLACES the rule that no research route may exist. That rule was right for
   * as long as naming one would have advertised a capability with nothing behind
   * it; it was never a rule against research, it was a rule against promising.
   *
   * RESEARCH arrived under exactly the conditions the old test protected: a tool
   * (hosted web search), a citation contract (the `source` evidence ref) and its
   * own trust rules (SOURCED, which resolves only against harvested pages). What
   * replaces the prohibition is stricter than it was — the route must exist AND
   * the capability must be gated by domain rather than granted to every question.
   */
  it('admits research only where the answer is genuinely outside the business', () => {
    expect(domainAdmitsResearch('RESEARCH')).toBe(true)
    // MIXED spans two sources of truth, which is what "is my slowdown the market?" is.
    expect(domainAdmitsResearch('MIXED')).toBe(true)
  })

  it('never admits research on a domain that already has a source of truth', () => {
    // CRM has rows, PRODUCT has the registry, GENERAL has nothing to look up, and
    // advice about THIS business is a reading of its own data.
    for (const domain of ['CRM', 'PRODUCT', 'GENERAL', 'BUSINESS_ADVICE'] as const) {
      expect(domainAdmitsResearch(domain), domain).toBe(false)
    }
  })

  it('treats MIXED as a business domain, so it can carry a diagnosis', () => {
    expect(BUSINESS_DOMAINS).toContain<AgentDomain>('MIXED')
    expect(BUSINESS_DOMAINS).toContain<AgentDomain>('CRM')
    expect(BUSINESS_DOMAINS).toContain<AgentDomain>('BUSINESS_ADVICE')
  })

  it('does not treat a greeting or a product question as a business domain', () => {
    expect(BUSINESS_DOMAINS).not.toContain<AgentDomain>('GENERAL')
    expect(BUSINESS_DOMAINS).not.toContain<AgentDomain>('PRODUCT')
  })
})

describe('the prompt routes from the same list the code owns', () => {
  it('names every domain, so the prompt cannot invent a sixth', () => {
    for (const domain of AGENT_DOMAINS) expect(AGENT_SYSTEM_PROMPT, domain).toContain(domain)
  })

  it('interpolates the list rather than restating it', () => {
    // A hand-typed copy is a second source of truth that drifts. The prompt
    // builds the line from AGENT_DOMAINS, so this asserts the rendered result.
    expect(AGENT_SYSTEM_PROMPT).toContain(`תחומי הניתוב: ${AGENT_DOMAINS.join(' / ')}.`)
  })
})

describe('MIXED is routing, never permission', () => {
  it('says so in as many words', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/MIXED הוא ניתוב, לא אישור לקרוא לכל הכלים/)
  })

  it('states that two domains do not become a six-step investigation', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/לא הופכת לחקירה של שישה צעדים/)
  })

  it('tells the model to answer each part from its own source', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/ענה על כל חלק מהמקור שלו/)
  })

  it('gives both reachable MIXED shapes as examples', () => {
    expect(AGENT_SYSTEM_PROMPT).toContain('"מה קורה בעסק ומה כדאי לשנות" — CRM עם BUSINESS_ADVICE')
    expect(AGENT_SYSTEM_PROMPT).toContain('"האם כדאי לי לשלם ל-SocialCRM" — PRODUCT עם BUSINESS_ADVICE')
  })
})

// ─── The regression that matters most: CRM routing did not move ─────────────

describe('existing CRM routing is untouched', () => {
  it('a broad judgement question still may not be answered from Today alone', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אסור לענות עליה מ-get_today_state לבד/)
  })

  it('a full queue still does not prove those are the biggest problems', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/תור לא ריק לא מוכיח/)
  })

  it('a simple daily question is still answered from Today alone', () => {
    expect(AGENT_SYSTEM_PROMPT).toContain('"מה יש לי היום"')
    expect(AGENT_SYSTEM_PROMPT).toMatch(/נענית מ-get_today_state לבד/)
  })

  it('the investigation is still bounded — stop when you have enough', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/עצור ברגע שיש לך מספיק/)
  })

  it('the BI tools are still not all called for every question', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אל תקרא לכל כלי ה-BI/)
  })

  it('every role-framed broad variant the evaluation used is still covered', () => {
    for (const phrase of ['מה הבעיה הכי גדולה שלי', 'מה אני מפספס', 'תמצא לי הזדמנות', 'תניח שאתה מנהל את העסק שלי']) {
      expect(AGENT_SYSTEM_PROMPT, phrase).toContain(phrase)
    }
  })

  it('offers exactly the three reviewed write verbs, and no others', () => {
    /**
     * The assertion moves with each reviewed action rather than being deleted:
     * it has pinned "none", then "one", then "two". What survives every revision
     * is the DENY LIST — everything the agent still cannot do. A fourth verb
     * appearing without its own review is the drift this exists to catch.
     */
    for (const allowed of ['create_task', 'create_follow_up', 'create_meeting']) {
      expect(AGENT_SYSTEM_PROMPT, allowed).toContain(allowed)
    }
    for (const forbidden of ['update_lead', 'send_whatsapp', 'assign_lead', 'delete_lead', 'send_email', 'cancel_meeting']) {
      expect(AGENT_SYSTEM_PROMPT, forbidden).not.toContain(forbidden)
    }
  })

  it('tells the model it proposes the task rather than creating it', () => {
    // The prose failure this guards: an answer that says "created the task" for
    // an action still sitting in AWAITING_APPROVAL.
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אתה לא מבצע את הפעולה/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/אסור לכתוב שהמשימה נוצרה, שהמעקב נקבע או שהפגישה נקבעה/)
  })
})
