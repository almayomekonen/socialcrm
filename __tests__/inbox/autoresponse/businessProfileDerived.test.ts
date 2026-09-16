import { describe, expect, it } from 'vitest'
import {
  BUSINESS_PROFILE_VERSION,
  formatBusinessProfileBlock,
  groundedFactsFromProfile,
  hashDescription,
  isProfileCurrent,
  parseBusinessProfile,
  type BusinessProfile,
} from '@/lib/inbox/autoresponse/businessProfile'
import { formatAgentCapabilityBlock, AGENT_CANNOT } from '@/lib/inbox/autoresponse/agentCapabilities'
import { formatBusinessIdentityBlock, groundedFactsFor } from '@/lib/inbox/autoresponse/businessIdentity'

/**
 * One description in, structured configuration out — and the line between what
 * the owner WANTS the conversation to achieve and what the agent can actually
 * DO. These cover the deterministic half: shape, staleness, grounding and the
 * capability boundary. Whether a real model derives a good profile from real
 * prose is a model-response question, in scripts/e2e/ire-business-profiles.e2e.ts.
 */

const GARAGE_DESCRIPTION =
  'אנחנו מוסך בחולון, פתוחים א׳–ה׳ 8:00–17:00. עושים טיפולים ותיקונים. ' +
  'ברר מה הבעיה ברכב, דגם ושנתון, ואסוף פרטים כדי שנחזור ללקוח לתיאום.'

const GARAGE_PROFILE: BusinessProfile = {
  version: BUSINESS_PROFILE_VERSION,
  sourceHash: hashDescription(GARAGE_DESCRIPTION),
  derivedAt: '2026-09-16T10:00:00.000Z',
  facts: ['מוסך בחולון', 'טיפולים ותיקונים לרכב'],
  explicit: { prices: [], hours: ['א׳–ה׳ 8:00–17:00'], policies: [] },
  objectives: ['לברר מה הבעיה ברכב', 'לאסוף פרטים כדי שהעסק יחזור לתיאום'],
  collect: ['מה הבעיה', 'דגם הרכב', 'שנתון'],
  tone: null,
  handoff: null,
  unsupportedRequests: [],
}

describe('staleness — a profile is only used for the text it came from', () => {
  it('is current for its own description', () => {
    expect(isProfileCurrent(GARAGE_PROFILE, GARAGE_DESCRIPTION)).toBe(true)
  })

  it('is stale the moment the owner edits a single character', () => {
    expect(isProfileCurrent(GARAGE_PROFILE, `${GARAGE_DESCRIPTION} גם מזגנים.`)).toBe(false)
  })

  it('is not current against an empty or missing description', () => {
    expect(isProfileCurrent(GARAGE_PROFILE, '')).toBe(false)
    expect(isProfileCurrent(GARAGE_PROFILE, null)).toBe(false)
    expect(isProfileCurrent(null, GARAGE_DESCRIPTION)).toBe(false)
  })

  it('ignores a profile written by an older version', () => {
    expect(isProfileCurrent({ ...GARAGE_PROFILE, version: 0 }, GARAGE_DESCRIPTION)).toBe(false)
    expect(parseBusinessProfile({ ...GARAGE_PROFILE, version: 0 })).toBeNull()
  })

  it('whitespace around the description does not change the hash', () => {
    expect(hashDescription(`  ${GARAGE_DESCRIPTION}  `)).toBe(hashDescription(GARAGE_DESCRIPTION))
  })
})

describe('parseBusinessProfile is defensive about what it reads back', () => {
  it('survives a JSON string, an object, junk and null', () => {
    expect(parseBusinessProfile(JSON.stringify(GARAGE_PROFILE))?.facts).toEqual(GARAGE_PROFILE.facts)
    expect(parseBusinessProfile(GARAGE_PROFILE)?.facts).toEqual(GARAGE_PROFILE.facts)
    expect(parseBusinessProfile('not json')).toBeNull()
    expect(parseBusinessProfile(null)).toBeNull()
    expect(parseBusinessProfile({ version: BUSINESS_PROFILE_VERSION })).toBeNull()
  })

  it('tolerates missing sections rather than throwing', () => {
    const partial = parseBusinessProfile({
      version: BUSINESS_PROFILE_VERSION,
      sourceHash: 'abc',
      derivedAt: 'x',
    })
    expect(partial?.facts).toEqual([])
    expect(partial?.explicit.prices).toEqual([])
  })
})

describe('the profile block omits empty sections rather than inviting invention', () => {
  it('renders only what the owner supplied', () => {
    const block = formatBusinessProfileBlock(GARAGE_PROFILE) ?? ''
    expect(block).toContain('מוסך בחולון')
    expect(block).toContain('א׳–ה׳ 8:00–17:00')
    // The garage stated no prices and no policy. Neither heading appears at all.
    expect(block).not.toContain('מחירים')
    expect(block).not.toContain('מדיניות')
  })

  it('keeps objectives visibly separate from facts', () => {
    const block = formatBusinessProfileBlock(GARAGE_PROFILE) ?? ''
    const factsAt = block.indexOf('עובדות על העסק')
    const objectivesAt = block.indexOf('מה שהשיחה אמורה להשיג')
    expect(factsAt).toBeGreaterThanOrEqual(0)
    expect(objectivesAt).toBeGreaterThan(factsAt)
    expect(block).toContain('מטרות, לא פעולות שאת/ה מבצע/ת')
  })

  it('returns null when the owner supplied nothing at all', () => {
    expect(
      formatBusinessProfileBlock({
        ...GARAGE_PROFILE,
        facts: [],
        explicit: { prices: [], hours: [], policies: [] },
        objectives: [],
        collect: [],
        unsupportedRequests: [],
      }),
    ).toBeNull()
  })
})

describe('grounding uses facts, never objectives', () => {
  it('quotable sections ground a figure', () => {
    const grounded = groundedFactsFromProfile(GARAGE_PROFILE, null) ?? ''
    expect(grounded).toContain('א׳–ה׳ 8:00–17:00')
    expect(grounded).toContain('מוסך בחולון')
  })

  it('"we book appointments" as an objective can never ground a booking claim', () => {
    const profile: BusinessProfile = {
      ...GARAGE_PROFILE,
      objectives: ['לקבוע תורים ללקוחות', 'המחיר לטיפול הוא 450'],
    }
    const grounded = groundedFactsFromProfile(profile, null) ?? ''
    expect(grounded).not.toContain('לקבוע תורים')
    expect(grounded).not.toContain('450')
  })

  it('falls back to the raw description when no profile was derived', () => {
    expect(groundedFactsFromProfile(null, GARAGE_DESCRIPTION)).toBe(GARAGE_DESCRIPTION)
  })

  it('groundedFactsFor prefers the profile and falls back to the description', () => {
    const withProfile = groundedFactsFor({
      agencyId: 1,
      name: 'מוסך אלון',
      guidance: GARAGE_DESCRIPTION,
      agentInstructions: null,
      isOwnProductBusiness: false,
      profile: GARAGE_PROFILE,
    })
    expect(withProfile).toContain('מוסך בחולון')
    expect(withProfile).not.toContain('ברר מה הבעיה') // an objective, not a fact

    const withoutProfile = groundedFactsFor({
      agencyId: 1,
      name: 'מוסך אלון',
      guidance: GARAGE_DESCRIPTION,
      agentInstructions: null,
      isOwnProductBusiness: false,
      profile: null,
    })
    expect(withoutProfile).toContain('ברר מה הבעיה')
  })
})

/**
 * The capability boundary. Writing "book appointments" states a goal; it does
 * not install a calendar.
 */
describe('objectives are not tools', () => {
  it('every prohibition names what to do instead', () => {
    for (const { cannot, instead } of AGENT_CANNOT) {
      expect(cannot.length).toBeGreaterThan(0)
      expect(instead.length, `"${cannot}" has no alternative`).toBeGreaterThan(0)
    }
  })

  it('the block forbids booking, charging, sending and updating', () => {
    const block = formatAgentCapabilityBlock()
    expect(block).toMatch(/אסור לקבוע, לשריין או לאשר תור/)
    expect(block).toMatch(/אסור לגבות תשלום/)
    expect(block).toMatch(/אסור לשלוח מייל, קישור, טופס/)
    expect(block).toMatch(/אסור לעדכן, לבטל או לשנות/)
  })

  it('states outright that the description grants goals, not tools', () => {
    const block = formatAgentCapabilityBlock()
    expect(block).toContain('תיאור העסק קובע מטרות ועובדות, לא כלים')
    expect(block).toContain('לעולם אל תדווח/י על פעולה כאילו כבר בוצעה')
  })

  it('offers a real alternative rather than a dead end', () => {
    const block = formatAgentCapabilityBlock()
    expect(block).toContain('לברר מתי נוח ללקוח, ולומר שאדם מהצוות יחזור לאשר')
  })

  it('reaches every agent prompt, whatever the business', () => {
    const block = formatBusinessIdentityBlock({
      agencyId: 9001,
      name: 'מוסך אלון',
      guidance: GARAGE_DESCRIPTION,
      agentInstructions: null,
      isOwnProductBusiness: false,
      profile: GARAGE_PROFILE,
    })
    expect(block).toContain('תיאור העסק קובע מטרות ועובדות, לא כלים')
  })

  it('a description asking for a booking surfaces as unsupported, and is still corrected in-prompt', () => {
    const wantsBooking: BusinessProfile = {
      ...GARAGE_PROFILE,
      objectives: ['לקבוע תור ללקוח'],
      unsupportedRequests: ['לקבוע תור ללקוח'],
    }
    const block = formatBusinessIdentityBlock({
      agencyId: 9002,
      name: 'מוסך אלון',
      guidance: GARAGE_DESCRIPTION,
      agentInstructions: null,
      isOwnProductBusiness: false,
      profile: wantsBooking,
    })
    expect(block).toContain('קדם/י אותם, אל תבצע/י ואל תדווח/י שבוצעו')
    expect(block).toContain('אסור לקבוע, לשריין או לאשר תור')
  })
})

describe('an undescribed business gets the old prose path, not a hollow profile', () => {
  it('falls back to the raw description when the profile is stale', () => {
    const block = formatBusinessIdentityBlock({
      agencyId: 9001,
      name: 'מוסך אלון',
      guidance: 'טקסט חדש לגמרי שלא עובד עדיין',
      agentInstructions: null,
      isOwnProductBusiness: false,
      profile: null,
    })
    expect(block).toContain('טקסט חדש לגמרי שלא עובד עדיין')
    expect(block).toContain('מה העסק עושה, ומה מותר לומר בשמו')
  })
})

/**
 * Found in the browser, not by inspection: the derivation prompt passed the
 * business name on its own "שם העסק: X" line directly above the description,
 * and the model transcribed that line into `facts`. A profile could then assert
 * a business name contradicting the description the owner actually wrote.
 */
describe('the business name is context for derivation, never a derived fact', () => {
  it('the prompt labels it out-of-band and forbids copying it', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'lib/inbox/autoresponse/businessProfile.ts'), 'utf8')
    expect(src).toContain('אסור להכניס אותו ל-facts')
    expect(src).toContain('(הקשר בלבד, לא להעתיק ולא להכניס ל-facts) העסק נקרא:')
    // The old shape, which the model copied, must not come back.
    expect(src).not.toMatch(/`שם העסק: \$\{args\.businessName\}`/)
  })

  it('a profile carrying a name line is still rendered, but the block never states a second name', () => {
    // Defence in depth: even a profile derived by the old prompt renders under
    // the identity block's own "שם העסק" line, which comes from the account.
    const block = formatBusinessIdentityBlock({
      agencyId: 9001,
      name: 'מוסך אלון',
      guidance: GARAGE_DESCRIPTION,
      agentInstructions: null,
      isOwnProductBusiness: false,
      profile: { ...GARAGE_PROFILE, facts: ['שם העסק: עסק אחר', 'מוסך בחולון'] },
    })
    const nameLines = block.split('\n').filter((l) => l.startsWith('שם העסק:'))
    expect(nameLines).toEqual(['שם העסק: מוסך אלון'])
  })
})
