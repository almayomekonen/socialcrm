import { afterEach, describe, expect, it } from 'vitest'
import { extractActivationCode, isOptOutText, parsePlatformCommand } from '@/lib/whatsapp/platform/commands'
import { formatActivationCode, generateActivationCode, hashActivationCode, hashPlatformSender } from '@/lib/whatsapp/platform/keys'
import {
  canUseOwnerWhatsappReminders,
  ownerWhatsappReminderAgencyIds,
  platformWhatsappPhoneNumberId,
} from '@/lib/flags/ownerWhatsappReminderFlags'
import { maskPhone, ownerReminderView } from '@/lib/whatsapp/platform/ownerReminderView'

describe('opt-out keywords: the whole message, nothing else', () => {
  it.each(['הסר', 'הסרה', 'עצור', 'STOP', 'stop', 'Stop.', '  הסר  ', 'הסר!', '"עצור"', 'הסרה 🙏', '‏הסר'])('%j opts out', (t) => {
    expect(isOptOutText(t)).toBe(true)
    expect(parsePlatformCommand(t)).toEqual({ kind: 'opt_out' })
  })

  it.each(['לא להסיר', 'הסר את הליד', 'תודה', 'stop it please', 'הסרתי', 'STOPS', ''])('%j does not', (t) => {
    expect(isOptOutText(t)).toBe(false)
    expect(parsePlatformCommand(t).kind).not.toBe('opt_out')
  })
})

describe('activation codes', () => {
  it('finds the code in the prefilled text, any case, and returns it canonical', () => {
    expect(parsePlatformCommand('הפעלת תזכורות SocialCRM: ABCD-2345')).toEqual({ kind: 'activation', code: 'ABCD2345' })
    expect(extractActivationCode('abcd-2345')).toBe('ABCD2345')
  })

  it('needs the dash and the alphabet: ordinary words and ambiguous letters are not codes', () => {
    for (const t of ['STRENGTH', 'ABCD2345', 'ABCD-1234', 'ABCO-2345', 'ABCDE-2345', 'שלום, מה המחיר?', 'SocialCRM']) {
      expect(extractActivationCode(t)).toBeNull()
    }
  })

  it('an opt-out keyword is never read as a code; anything else is ignored', () => {
    expect(parsePlatformCommand('תודה רבה').kind).toBe('other')
    expect(parsePlatformCommand(undefined).kind).toBe('other')
    expect(parsePlatformCommand(`ABCD-2345 ${'x'.repeat(300)}`).kind).toBe('other')
  })

  it('generates 8 characters from the unambiguous alphabet, shown as XXXX-XXXX', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateActivationCode()
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
      expect(parsePlatformCommand(`קוד ${formatActivationCode(code)}`)).toEqual({ kind: 'activation', code })
    }
  })

  it('hashes are keyed, case-insensitive for codes, and never contain the input', () => {
    expect(hashActivationCode('abcd2345')).toBe(hashActivationCode('ABCD2345'))
    expect(hashActivationCode('ABCD2345')).not.toContain('ABCD')
    expect(hashPlatformSender('972500000001')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashPlatformSender('972500000001')).not.toBe(hashPlatformSender('972500000002'))
    expect(hashPlatformSender('972500000001')).not.toBe(hashActivationCode('972500000001'))
  })
})

describe('rollout gates: absence blocks', () => {
  const KEYS = ['PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_WA_ME_NUMBER', 'OWNER_WA_REMINDERS_AGENCY_IDS']
  afterEach(() => KEYS.forEach((k) => delete process.env[k]))

  it('unset means no platform number and no agency', () => {
    expect(platformWhatsappPhoneNumberId()).toBeNull()
    expect(ownerWhatsappReminderAgencyIds()).toEqual([])
    expect(canUseOwnerWhatsappReminders(103)).toBe(false)
  })

  it('explicit agency ids only; "all" and junk open nothing', () => {
    process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = '1000000000001'
    process.env.PLATFORM_WHATSAPP_WA_ME_NUMBER = '972500000000'
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = 'all, *, true, 0x67, 103 ,103'
    expect(ownerWhatsappReminderAgencyIds()).toEqual([103])
    expect(canUseOwnerWhatsappReminders(103)).toBe(true)
    expect(canUseOwnerWhatsappReminders(158)).toBe(false)
  })

  it('the allowlist alone is not enough: the platform number must be configured', () => {
    process.env.OWNER_WA_REMINDERS_AGENCY_IDS = '103'
    expect(canUseOwnerWhatsappReminders(103)).toBe(false)
  })
})

describe('settings view', () => {
  const row = (over: Record<string, unknown>) =>
    ({ status: 'pending', phoneE164: null, activationExpiresAt: null, verifiedAt: null, optedOutAt: null, ...over }) as never
  const now = new Date('2026-10-12T10:00:00Z')

  it('shows only the last two digits', () => {
    expect(maskPhone('+972500000072')).toBe('••••••72')
    expect(ownerReminderView(row({ status: 'active', phoneE164: '+972500000072' }), now)).toEqual({ state: 'active', maskedPhone: '••••••72', assistant: 'not_offered', personalReminders: 'not_offered' })
  })

  it('an expired code reads as off; a live one as pending', () => {
    expect(ownerReminderView(row({ activationExpiresAt: new Date('2026-10-12T09:59:00Z') }), now).state).toBe('off')
    expect(ownerReminderView(row({ activationExpiresAt: new Date('2026-10-12T10:05:00Z') }), now).state).toBe('pending')
    expect(ownerReminderView(null, now).state).toBe('off')
    expect(ownerReminderView(row({ status: 'opted_out' }), now).state).toBe('opted_out')
  })
})
