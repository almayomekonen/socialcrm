import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { QUALIFY_SYSTEM_PROMPT, buildQualifyUser } from '@/lib/inbox/autoresponse/qualifyPrompt'
import { classifyResponseProfile } from '@/lib/inbox/autoresponse/responseProfile'

function userWith(lastInbound: string, over: Partial<Parameters<typeof buildQualifyUser>[0]> = {}) {
  const profile =
    over.responseProfile === undefined
      ? classifyResponseProfile({ lastInbound, recentCustomerTexts: [lastInbound] })
      : over.responseProfile
  return buildQualifyUser({
    transcript: [{ direction: 'inbound', text: lastInbound }],
    qualification: {},
    collectFields: { required: [], optional: [] },
    guidance: null,
    salesMove: 'DISCOVERY',
    salesStrategy: 'discover',
    ...over,
    responseProfile: profile,
  })
}

describe('QUALIFY_SYSTEM_PROMPT delivery', () => {
  it('does not force Hebrew on every reply', () => {
    expect(QUALIFY_SYSTEM_PROMPT).not.toMatch(/^- עברית, גוף ראשון יחיד/)
    expect(QUALIFY_SYSTEM_PROMPT).not.toContain('- עברית, גוף ראשון יחיד, טבעי וקצר.')
    expect(QUALIFY_SYSTEM_PROMPT).toContain("If the inbound contains Hebrew, answer in Hebrew")
    expect(QUALIFY_SYSTEM_PROMPT).toContain('If the inbound is English-only, answer in English')
    expect(QUALIFY_SYSTEM_PROMPT).toContain("MIRROR, DON'T MIMIC")
  })

  it('keeps product, pricing, and safety rules', () => {
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אסור להתחייב בשם העסק')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('בשאלה על מה שהעסק מציע: קודם תשובה ישירה')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('ResponseProfile changes delivery only')
  })

  it('frustrated and urgency are delivery guidance, not policy', () => {
    expect(QUALIFY_SYSTEM_PROMPT).toContain('Frustrated customers get one short recognition clause')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('Urgency affects brevity and directness, not business policy')
  })
})

describe('buildQualifyUser Delivery profile', () => {
  it('Hebrew inbound produces Hebrew delivery instruction', () => {
    const user = userWith('היי אחי מה קורה?')
    expect(user).toContain('language=he')
  })

  it('English-only inbound produces English delivery instruction', () => {
    const user = userWith("Hey, what's up? How does this work?")
    expect(user).toContain('language=en')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('If the inbound is English-only, answer in English')
  })

  it('mixed Hebrew/English selects Hebrew', () => {
    const user = userWith('Hi אחי, כמה עולה?')
    expect(user).toContain('language=he')
  })

  it('casual profile appears in Delivery block', () => {
    const user = userWith('היי אחי מה נשמע?')
    expect(user).toMatch(/tone=casual/)
    expect(user).toContain('Delivery profile:')
  })

  it('professional profile appears', () => {
    const user = userWith('שלום, אשמח להבין מה המערכת מציעה', {
      salesMove: 'PRODUCT_QUESTION',
      salesStrategy: 'how_it_works',
    })
    expect(user).toContain('tone=professional')
  })

  it('vocative appears only when provided', () => {
    const withVocative = userWith('היי אחי מה קורה?')
    expect(withVocative).toContain('vocative=אחי')
    const without = userWith('מה המחיר?', { salesMove: 'BUYING_SIGNAL', salesStrategy: 'next_step' })
    expect(without).toContain('vocative=none')
    expect(without).not.toContain('vocative=אחי')
  })

  it('null vocative does not instruct the model to invent one', () => {
    const user = userWith('מה המחיר?', { salesMove: 'BUYING_SIGNAL', salesStrategy: 'next_step' })
    expect(user).toContain('Do not invent a vocative.')
  })

  it('frustrated emotion produces the recognition instruction', () => {
    const user = userWith('אני מתוסכל, אני מאבד לידים')
    expect(user).toContain('emotion=frustrated')
    expect(user).toContain('One short recognition clause, then continue the existing sales task.')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('Frustrated customers get one short recognition clause')
  })

  it('urgency=high is represented as delivery guidance only', () => {
    const user = userWith('אני חייב תשובה עכשיו')
    expect(user).toContain('urgency=high')
    expect(user).toContain('Urgency is delivery only')
    expect(user).toContain('Do not change business policy')
  })

  it('ResponseProfile is NOT part of JSON output schema', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/inbox/autoresponse/qualify.ts'), 'utf8')
    const schema = src.slice(src.indexOf('const QualifySchema'), src.indexOf('export type QualifyGenResult'))
    expect(schema).not.toMatch(/responseProfile/)
    expect(schema).not.toMatch(/vocative/)
    expect(schema).not.toMatch(/establishedTone/)
    expect(schema).not.toMatch(/customerStyle/)
    expect(QUALIFY_SYSTEM_PROMPT).not.toMatch(/return tone/i)
  })

  it('salesMove product contract lines still present beside delivery', () => {
    const user = userWith('אחי כמה עולה?', {
      salesMove: 'BUYING_SIGNAL',
      salesStrategy: 'next_step',
    })
    expect(user).toMatch(/מאותת קנייה|איך מתקדמים/)
    expect(user).toMatch(/tone=casual/)
  })
})
