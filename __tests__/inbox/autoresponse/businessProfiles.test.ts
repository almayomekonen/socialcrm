import { describe, expect, it } from 'vitest'
import { formatBusinessIdentityBlock, type BusinessIdentity } from '@/lib/inbox/autoresponse/businessIdentity'
import { buildQualifyUser, QUALIFY_SYSTEM_PROMPT } from '@/lib/inbox/autoresponse/qualifyPrompt'
import { formatProductKnowledgeBlock, retrieveProductKnowledge } from '@/lib/inbox/autoresponse/productRetrieve'
import { deterministicQualifyFallback } from '@/lib/inbox/autoresponse/qualify'
import { isOwnBusinessAccount } from '@/lib/inbox/autoresponse/ownBusinessAccount'

/**
 * V3 — three synthetic businesses with explicitly-defined facts. The same
 * customer question must produce a prompt grounded in THAT business, with no
 * trace of any other.
 *
 * SCOPE. These assert what the agent is TOLD — the prompt it receives and the
 * deterministic text it can emit. Whether a live model then behaves is a
 * model-response question, evaluated separately in
 * scripts/e2e/ire-business-profiles.e2e.ts. The distinction matters: a passing
 * test here proves the SocialCRM assumptions are gone from the shared layer, not
 * that the model is well-behaved.
 */

const CLINIC: BusinessIdentity = {
  agencyId: 9001,
  name: 'קליניקת אורורה',
  guidance:
    'קליניקה לטיפולי עור ואסתטיקה. מטפלות מוסמכות. הצהרת בריאות נחתמת אונליין לפני ההגעה. חניה בחצר.',
  agentInstructions: 'לשאול מה סוג הטיפול שמעניין. מחירים והתאמה רפואית להשאיר לצוות.',
  isOwnProductBusiness: false,
  profile: null,
}

const GARAGE: BusinessIdentity = {
  agencyId: 9002,
  name: 'מוסך אלון',
  guidance: 'מוסך מורשה לרכבים פרטיים. טיפולי שגרה, בלמים, מזגן ובדיקות לפני טסט. עבודה בתיאום מראש.',
  agentInstructions: 'לברר איזה רכב ומה התקלה. הצעות מחיר נותנים רק במוסך.',
  isOwnProductBusiness: false,
  profile: null,
}

const SOCIALCRM: BusinessIdentity = {
  agencyId: 103,
  name: 'SocialCRM',
  guidance: 'מערכת לניהול לידים מרשתות חברתיות. מרכזת פניות, וואטסאפ וסטטוס במקום אחד.',
  agentInstructions: null,
  isOwnProductBusiness: true,
  profile: null,
}

const ALL = [CLINIC, GARAGE, SOCIALCRM]

function promptFor(identity: BusinessIdentity, inbound: string, salesMove = 'PRODUCT_QUESTION') {
  const pk = retrieveProductKnowledge({
    agencyId: identity.agencyId,
    inboundText: inbound,
    salesMove: salesMove as 'PRODUCT_QUESTION',
    // Only SocialCRM's own account is on the product-knowledge allowlist.
    envRaw: identity.isOwnProductBusiness ? String(identity.agencyId) : '',
  })
  return buildQualifyUser({
    transcript: [{ direction: 'inbound', text: inbound }],
    qualification: {},
    collectFields: { required: [], optional: [] },
    guidance: identity.guidance,
    businessIdentityBlock: formatBusinessIdentityBlock(identity),
    productKnowledgeBlock: formatProductKnowledgeBlock(pk),
    salesMove,
  })
}

/** Terms that belong to SocialCRM's own sales motion and nobody else's. */
const SOCIALCRM_TERMS = [/SocialCRM/i, /ניהול לידים/, /לידים/, /\bCRM\b/, /רשתות חברתיות/]

describe('the shared prompt layer names no industry', () => {
  it('the system prompt carries no SocialCRM vocabulary', () => {
    for (const re of SOCIALCRM_TERMS) {
      expect(QUALIFY_SYSTEM_PROMPT, `system prompt still mentions ${re}`).not.toMatch(re)
    }
  })

  it('the system prompt names no trade and assumes none', () => {
    expect(QUALIFY_SYSTEM_PROMPT).toMatch(/אל תניח\/י תחום עיסוק/)
    expect(QUALIFY_SYSTEM_PROMPT).toMatch(/אין לך שום ידע מוקדם על העסק/)
  })

  it('the system prompt forbids mentioning other businesses or systems', () => {
    expect(formatBusinessIdentityBlock(CLINIC)).toMatch(/אין לך מידע על עסקים אחרים/)
  })
})

describe('V3 — the same question, three businesses, no bleed', () => {
  const QUESTION = 'מה אתם עושים?'

  it('each prompt is grounded in its own business facts', () => {
    expect(promptFor(CLINIC, QUESTION)).toContain('טיפולי עור ואסתטיקה')
    expect(promptFor(GARAGE, QUESTION)).toContain('מוסך מורשה')
    expect(promptFor(SOCIALCRM, QUESTION)).toContain('ניהול לידים')
  })

  it("no business's prompt contains another business's facts", () => {
    const clinic = promptFor(CLINIC, QUESTION)
    const garage = promptFor(GARAGE, QUESTION)

    expect(clinic).not.toContain('מוסך')
    expect(clinic).not.toContain('בלמים')
    expect(garage).not.toContain('קליניקה')
    expect(garage).not.toContain('הצהרת בריאות')
  })

  it('neither ordinary business receives SocialCRM product knowledge', () => {
    for (const identity of [CLINIC, GARAGE]) {
      const prompt = promptFor(identity, QUESTION)
      for (const re of SOCIALCRM_TERMS) {
        expect(prompt, `${identity.name} prompt leaks ${re}`).not.toMatch(re)
      }
    }
  })

  it("SocialCRM's own account still gets its catalogue — the capability is scoped, not deleted", () => {
    expect(isOwnBusinessAccount(103, '103')).toBe(true)
    expect(isOwnBusinessAccount(9001, '103')).toBe(false)
    expect(isOwnBusinessAccount(9001, '')).toBe(false)
    const pk = retrieveProductKnowledge({
      agencyId: 103,
      inboundText: 'יש לכם מענה אוטומטי בוואטסאפ?',
      salesMove: 'PRODUCT_QUESTION',
      envRaw: '103',
    })
    expect(pk.enabled).toBe(true)
    expect(formatProductKnowledgeBlock(pk)).toBeTruthy()
  })

  it('an ordinary business gets no product block at all', () => {
    const pk = retrieveProductKnowledge({
      agencyId: 9001,
      inboundText: 'יש לכם מענה אוטומטי בוואטסאפ?',
      salesMove: 'PRODUCT_QUESTION',
      envRaw: '103',
    })
    expect(pk.enabled).toBe(false)
    expect(formatProductKnowledgeBlock(pk)).toBeNull()
  })
})

describe("the owner's agent instructions reach the prompt, separately from the facts", () => {
  it('appears as instructions, not as business facts', () => {
    const block = formatBusinessIdentityBlock(CLINIC)
    expect(block).toContain('הנחיות מבעל/ת העסק לניהול השיחה: לשאול מה סוג הטיפול')
    expect(block).toContain('מה העסק עושה, ומה מותר לומר בשמו')
  })

  it('is simply absent when the owner left it empty', () => {
    expect(formatBusinessIdentityBlock(SOCIALCRM)).not.toContain('הנחיות מבעל/ת העסק')
  })
})

describe('an unconfigured business is told it has no facts, not given plausible ones', () => {
  const EMPTY: BusinessIdentity = {
    agencyId: 9003,
    name: null,
    guidance: null,
    agentInstructions: null,
      isOwnProductBusiness: false,
    profile: null,
  }

  it('says so explicitly', () => {
    const block = formatBusinessIdentityBlock(EMPTY)
    expect(block).toContain('שם העסק: (לא סופק)')
    expect(block).toContain('אין לך עובדות מאומתות על העסק הזה')
  })

  it('still forbids invention', () => {
    expect(formatBusinessIdentityBlock(EMPTY)).toMatch(/אסור להמציא שירות, מוצר, יכולת, מחיר/)
  })
})

describe('V4 — the deterministic fallback can never name a product', () => {
  for (const lang of ['he', 'en'] as const) {
    for (const salesMove of ['PRODUCT_QUESTION', 'PRODUCT_FIT', 'BUYING_SIGNAL'] as const) {
      it(`${salesMove} / ${lang} defers instead of describing a capability`, () => {
        const text = deterministicQualifyFallback({
          qualification: {},
          lastInboundText: 'מה המערכת שלכם עושה?',
          lang,
          salesMove,
        })
        for (const re of SOCIALCRM_TERMS) {
          expect(text, `fallback leaks ${re}`).not.toMatch(re)
        }
        expect(text).not.toMatch(/מענה אוטומטי|automatic reply|warm-?up|חימום/i)
      })
    }
  }

  it('no customer-facing literal in the agent tree names the product', async () => {
    // A static guard, in the spirit of the existing agentSendGuardCoverage test:
    // the regression this locks is a hardcoded SocialCRM sentence that any
    // tenant's customer could receive.
    const { readFileSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(process.cwd(), 'lib/inbox/autoresponse')
    const offenders: string[] = []
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      // productRetrieve/ownBusinessAccount legitimately reference the catalogue;
      // they are gated to SocialCRM's own account by construction.
      if (file === 'productRetrieve.ts' || file === 'ownBusinessAccount.ts') continue
      const body = readFileSync(join(dir, file), 'utf8')
      for (const line of body.split('\n')) {
        const code = line.trim()
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) continue
        if (/['"`][^'"`]*SocialCRM/.test(code)) offenders.push(`${file}: ${code.slice(0, 90)}`)
      }
    }
    expect(offenders, `customer-facing literals naming the product:\n${offenders.join('\n')}`).toEqual([])
  })
})
