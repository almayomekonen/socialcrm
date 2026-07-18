import { describe, it, expect } from 'vitest'
import { renderEmail } from '@/lib/email/render'
import FacebookNotConnectedEmail from '@/emails/templates/FacebookNotConnectedEmail'
import WhatsappNotConnectedEmail from '@/emails/templates/WhatsappNotConnectedEmail'
import FirstLeadEmail from '@/emails/templates/FirstLeadEmail'
import NoActivityEmail from '@/emails/templates/NoActivityEmail'
import TrialEndingEmail from '@/emails/templates/TrialEndingEmail'

const UNSUB = 'https://getsocialcrm.com/api/email/unsubscribe?u=7&t=abc'

const lifecycle = [
  { name: 'facebook', render: (u?: string) => FacebookNotConnectedEmail({ firstName: 'דוד', ctaUrl: 'https://app/settings/facebook', unsubscribeUrl: u }) },
  { name: 'whatsapp', render: (u?: string) => WhatsappNotConnectedEmail({ firstName: 'דוד', ctaUrl: 'https://app/settings/facebook', unsubscribeUrl: u }) },
  { name: 'first_lead', render: (u?: string) => FirstLeadEmail({ firstName: 'דוד', ctaUrl: 'https://app/leads', unsubscribeUrl: u }) },
  { name: 'no_activity', render: (u?: string) => NoActivityEmail({ firstName: 'דוד', ctaUrl: 'https://app/dashboard', unsubscribeUrl: u }) },
]

describe('lifecycle templates render + unsubscribe footer', () => {
  for (const t of lifecycle) {
    it(`${t.name}: renders and includes the unsubscribe link when provided`, async () => {
      const html = await renderEmail(t.render(UNSUB))
      expect(html).toContain('הסרה מרשימת התפוצה')
      expect(html).toContain('/api/email/unsubscribe?u=7')
    })
    it(`${t.name}: omits the unsubscribe footer when no url is passed`, async () => {
      const html = await renderEmail(t.render(undefined))
      expect(html).not.toContain('הסרה מרשימת התפוצה')
    })
  }
})

describe('transactional template', () => {
  it('trial_ending renders and never shows an unsubscribe footer', async () => {
    const html = await renderEmail(TrialEndingEmail({ firstName: 'דוד', ctaUrl: 'https://app/settings/update_payment' }))
    expect(html).toContain('תקופת הניסיון')
    expect(html).not.toContain('הסרה מרשימת התפוצה')
  })
})
