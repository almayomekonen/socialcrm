import { describe, expect, it } from 'vitest'
import { renderAutomationEmail, substituteVariables } from '@/lib/automations/renderEmail'

const VARS = { leadFirstName: 'דנה', businessName: 'סטודיו אור', repName: 'יעל' }

describe('substituteVariables', () => {
  it('substitutes the full closed set', () => {
    const out = substituteVariables('שלום {{שם הליד}}, מ{{שם העסק}} ({{שם הנציג}})', VARS)
    expect(out).toBe('שלום דנה, מסטודיו אור (יעל)')
  })

  it('degrades gracefully without a first name: "שלום דנה," becomes "שלום,"', () => {
    const out = substituteVariables('שלום {{שם הליד}},', { ...VARS, leadFirstName: null })
    expect(out).toBe('שלום,')
  })

  it('repName falls back to the business; business falls back to a neutral default', () => {
    expect(substituteVariables('{{שם הנציג}}', { ...VARS, repName: null })).toBe('סטודיו אור')
    expect(substituteVariables('{{שם העסק}}', { leadFirstName: null, businessName: null, repName: null })).toBe('העסק')
  })
})

describe('renderAutomationEmail', () => {
  it('renders RTL html with the substituted content and the mandatory unsubscribe link', async () => {
    const rendered = await renderAutomationEmail({
      subject: 'ברוכים הבאים ל{{שם העסק}}',
      body: 'שלום {{שם הליד}},\n\nתודה שפנית אלינו.',
      vars: VARS,
      unsubscribeUrl: 'https://app.example.com/api/automations/unsubscribe?a=7&l=42&t=tok',
    })
    expect(rendered.subject).toBe('ברוכים הבאים לסטודיו אור')
    expect(rendered.html).toContain('dir="rtl"')
    expect(rendered.html).toContain('שלום דנה,')
    expect(rendered.html).toContain('https://app.example.com/api/automations/unsubscribe?a=7&amp;l=42&amp;t=tok')
    expect(rendered.html).toContain('הסרה מרשימת התפוצה')
    expect(rendered.text).toContain('הסרה מרשימת התפוצה')
  })
})
