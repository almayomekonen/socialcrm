/**
 * Consent v5 (Reminder Engine Phase 4), pure parts: which versions count, what
 * the draft text must cover, the Settings view, and the switch. No DB.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  ASSISTANT_CONSENT_VERSIONS,
  OWNER_WA_ASSISTANT_CONSENT,
  OWNER_WA_PERSONAL_REMINDERS_CONSENT,
  activationConsentFor,
  consentCoversAssistant,
  consentCoversPersonalReminders,
} from '@/lib/whatsapp/platform/consentText'
import { ownerReminderView } from '@/lib/whatsapp/platform/ownerReminderView'
import { isWaAssistantRemindersAgency } from '@/lib/flags/waAssistantFlags'
import type { OwnRecipientRow } from '@/db/ownerWhatsappRecipients'

const ENV = ['WA_ASSISTANT_AGENCY_IDS', 'WA_ASSISTANT_REMINDERS_AGENCY_IDS', 'WA_ASSISTANT_AUDIENCE'] as const
afterEach(() => {
  for (const k of ENV) delete process.env[k]
})

describe('which recorded versions count', () => {
  it('personal reminders: v5 only; v4 never silently counts', () => {
    expect(OWNER_WA_PERSONAL_REMINDERS_CONSENT.version).toBe('v5')
    for (const v of ['v2', 'v3', 'v4', null, undefined, '']) expect(consentCoversPersonalReminders(v), String(v)).toBe(false)
    expect(consentCoversPersonalReminders('v5')).toBe(true)
  })

  it('the assistant: v3, v4 and v5 (v5 contains v4); v2 never', () => {
    expect(ASSISTANT_CONSENT_VERSIONS).toEqual(['v3', 'v4', 'v5'])
    expect(consentCoversAssistant('v5')).toBe(true)
    expect(consentCoversAssistant('v2')).toBe(false)
  })

  it('activation never records v5: it is an explicit Settings choice only', () => {
    expect(activationConsentFor(true).version).toBe(OWNER_WA_ASSISTANT_CONSENT.version)
    expect(activationConsentFor(false).version).toBe('v2')
  })
})

describe('the v5 draft text (pending legal review) covers what the architecture requires', () => {
  const text = OWNER_WA_PERSONAL_REMINDERS_CONSENT.text
  it.each([
    ['proactive personal reminders, at the time asked', 'תזכורות אישיות שביקשתי מהעוזר, במועד שביקשתי'],
    ['outside a conversation', 'גם כשאני לא בשיחה איתו'],
    ['the WhatsApp destination: this number only', 'למספר הזה בלבד'],
    ['never sent to a lead', 'ולעולם לא ללקוח או לליד שמוזכר בה'],
    ['message costs may apply (never "free")', 'כרוכה בעלויות'],
    ['a separate stop for personal reminders', 'להפסיק רק את התזכורות האישיות בדף הזה'],
    ['the assistant consent it contains', 'לנהל איתי שיחות בוואטסאפ עם העוזר החכם של SocialCRM'],
  ])('%s', (_label, phrase) => {
    expect(text).toContain(phrase)
  })

  it('does not say reminders are free', () => {
    expect(text).not.toMatch(/ללא עלות|בחינם/)
  })
})

describe('the Settings view', () => {
  const row = (consentTextVersion: string): OwnRecipientRow => ({
    status: 'active', phoneE164: '+972501234567', activationExpiresAt: null, verifiedAt: new Date(), optedOutAt: null, consentTextVersion,
  })
  const view = (v: string, opts: { assistantEnabled?: boolean; personalRemindersEnabled?: boolean }) => ownerReminderView(row(v), new Date(), opts).personalReminders

  it('offered only with the switch on AND the assistant granted', () => {
    expect(view('v4', { assistantEnabled: true, personalRemindersEnabled: false })).toBe('not_offered')
    expect(view('v2', { assistantEnabled: true, personalRemindersEnabled: true })).toBe('not_offered')
    expect(view('v4', { assistantEnabled: true, personalRemindersEnabled: true })).toBe('consent_required')
    expect(view('v5', { assistantEnabled: true, personalRemindersEnabled: true })).toBe('granted')
  })

  it('v5 shows the assistant as granted too', () => {
    expect(ownerReminderView(row('v5'), new Date(), { assistantEnabled: true }).assistant).toBe('granted')
  })

  it('a row that is not active is never offered', () => {
    expect(ownerReminderView({ ...row('v5'), status: 'opted_out' }, new Date(), { assistantEnabled: true, personalRemindersEnabled: true }).personalReminders).toBe('not_offered')
  })
})

describe('WA_ASSISTANT_REMINDERS_AGENCY_IDS', () => {
  it('absent = off; explicit ids only; and only on top of the assistant', () => {
    expect(isWaAssistantRemindersAgency(7)).toBe(false)
    process.env.WA_ASSISTANT_REMINDERS_AGENCY_IDS = '7'
    expect(isWaAssistantRemindersAgency(7)).toBe(false) // the assistant itself is off
    process.env.WA_ASSISTANT_AGENCY_IDS = '7'
    expect(isWaAssistantRemindersAgency(7)).toBe(true)
    expect(isWaAssistantRemindersAgency(8)).toBe(false)
    process.env.WA_ASSISTANT_REMINDERS_AGENCY_IDS = 'all'
    expect(isWaAssistantRemindersAgency(7)).toBe(false)
  })
})
