import { describe, expect, it } from 'vitest'
import { renderAutomationEmail } from '@/lib/automations/renderEmail'
import {
  AA_LARGE,
  AA_NORMAL,
  accessibleTextOn,
  contrastRatio,
  darken,
  parseHex,
  resolveAccent,
} from '@/lib/automations/email/contrast'
import { APPLE_MAIL, GMAIL_ENGLISH_UI, deliver } from './support/mailClients'

/**
 * Phase 5 — brand presence, and the two guards that keep it from producing
 * something unreadable or broken.
 */

const VARS = { leadFirstName: 'דנה', businessName: 'סטודיו אור', repName: null }
const BODY = 'שלום {{שם הליד}},\n\nהפנייה שלך התקבלה.\n\nבברכה,\n{{שם העסק}}'
const ACTION = { label: 'לקביעת שיחה', url: 'https://example.co.il/book' }

const render = (over: Record<string, unknown> = {}) =>
  renderAutomationEmail({ subject: 'עדכון', body: BODY, vars: VARS, unsubscribeUrl: 'https://x.co/u', ...over })

describe('contrast guard — the label colour is derived, never configured', () => {
  it('computes ratios that match the WCAG reference', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 2)
    // The footer grey used by the shell: passes AA for normal text, but barely.
    expect(contrastRatio('#6b7280', '#ffffff')).toBeCloseTo(4.83, 1)
  })

  it('parses both hex forms and rejects junk', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHex('1d4ed8')).toEqual({ r: 29, g: 78, b: 216 })
    expect(parseHex('rebeccapurple')).toBeNull()
    expect(parseHex('')).toBeNull()
  })

  it('picks a readable label for pale and dark brands alike', () => {
    // The failure this exists to prevent: a pale brand yellow with a white label.
    expect(accessibleTextOn('#ffe066')).toBe('#111111')
    expect(accessibleTextOn('#1d4ed8')).toBe('#ffffff')
    for (const brand of ['#ffe066', '#1d4ed8', '#00b3a4', '#111111', '#f5f5f5']) {
      expect(contrastRatio(accessibleTextOn(brand), brand)).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  it('gives every fill a darker edge, so an invisible button is unreachable', () => {
    // The failure a threshold could not separate from a real brand yellow:
    // near-white fill on a white surface. Solved structurally instead.
    for (const pale of ['#fefefe', '#ffffff', '#fff8e1', '#ffe066']) {
      const decision = resolveAccent(pale, '#1d4ed8')
      expect(decision.accent, `${pale} was overridden`).toBe(pale)
      expect(contrastRatio(decision.accentBorder, pale)).toBeGreaterThan(1.2)
      expect(contrastRatio(decision.accentText, pale)).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  it('keeps mid-grey, because a solid fill can always find a readable label', () => {
    // Documents why the label is never the failing constraint: even at the worst
    // case for both black and white, the better option still clears the floor.
    const decision = resolveAccent('#767676', '#1d4ed8')
    expect(decision.substituted).toBe(false)
    expect(contrastRatio(decision.accentText, '#767676')).toBeGreaterThanOrEqual(AA_LARGE)
  })

  it('honours a pale brand, deriving a dark label for it', () => {
    for (const pale of ['#ffe066', '#fff8e1', '#d1fae5']) {
      const decision = resolveAccent(pale, '#1d4ed8')
      expect(decision.substituted, `${pale} was overridden`).toBe(false)
      expect(decision.accentText).toBe('#111111')
    }
  })

  it('darkens toward black without overflowing a channel', () => {
    expect(darken('#ffffff', 0.22)).toBe('#c7c7c7')
    expect(darken('#000000', 0.22)).toBe('#000000')
    expect(darken('not-a-colour', 0.22)).toBe('not-a-colour')
  })

  it('falls back to the platform accent when none is supplied', () => {
    for (const absent of [null, undefined, '']) {
      const decision = resolveAccent(absent as string | null, '#1d4ed8')
      expect(decision.accent).toBe('#1d4ed8')
      // Absent is not a mistake, so nothing was substituted.
      expect(decision.substituted).toBe(false)
    }
  })

  it('flags a malformed accent as substituted, so it can be surfaced', () => {
    const decision = resolveAccent('not-a-colour', '#1d4ed8')
    expect(decision.accent).toBe('#1d4ed8')
    expect(decision.substituted).toBe(true)
  })

  it('paints the CTA with the guarded pair', async () => {
    const { html } = await render({ action: ACTION, brand: { accent: '#ffe066' } })
    const { root } = deliver(html, APPLE_MAIL)
    const link = root.querySelector<HTMLElement>('a[href="https://example.co.il/book"]')!
    const cell = link.closest('td') as HTMLElement
    expect(cell.style.getPropertyValue('background-color')).toContain('255, 224, 102')
    // Near-black on the pale brand, not the default white.
    expect(contrastRatio(link.style.getPropertyValue('color') ? '#111111' : '#ffffff', '#ffe066')).toBeGreaterThanOrEqual(
      AA_LARGE,
    )
    expect(link.getAttribute('style')).toContain('#111111')
  })
})

describe('brand header — the wordmark is the normal state, not a degraded one', () => {
  it('renders the business name when there is no logo', async () => {
    const { html } = await render()
    const { blockTextBlocks } = deliver(html, GMAIL_ENGLISH_UI)
    const wordmark = blockTextBlocks.find((b) => (b.textContent ?? '').trim() === 'סטודיו אור')
    expect(wordmark, 'no wordmark rendered').toBeDefined()
    // Distinct from body copy, and carrying its own direction like every block.
    expect(parseInt(wordmark!.style.getPropertyValue('font-size'), 10)).toBeGreaterThanOrEqual(20)
    expect(wordmark!.getAttribute('dir')).toBe('rtl')
  })

  it('renders a logo when a durable url is supplied, with the name as alt text', async () => {
    const { html } = await render({ brand: { logoUrl: 'https://cdn.example.com/logo.png' } })
    const { root } = deliver(html, APPLE_MAIL)
    const img = root.querySelector<HTMLImageElement>('img')
    expect(img, 'no logo rendered').not.toBeNull()
    expect(img!.getAttribute('src')).toBe('https://cdn.example.com/logo.png')
    // Images are blocked by default in many clients, so alt text is what most
    // recipients actually see — it must be the business name, styled.
    expect(img!.getAttribute('alt')).toBe('סטודיו אור')
    expect(img!.getAttribute('style')).toContain('font-weight')
  })

  it('never renders an empty logo slot', async () => {
    const { html } = await render({ brand: { logoUrl: null } })
    const { root } = deliver(html, APPLE_MAIL)
    expect(root.querySelectorAll('img').length).toBe(0)
  })

  it('two brands produce different emails from identical copy', async () => {
    const a = await render({ action: ACTION, brand: { accent: '#1d4ed8' } })
    const b = await render({ action: ACTION, brand: { accent: '#00b3a4' } })
    expect(a.html).not.toBe(b.html)
    // ...and the copy itself is unchanged.
    expect(a.text).toBe(b.text)
  })

  it('leaves the plain-text alternative free of brand chrome', async () => {
    const { text } = await render({ brand: { accent: '#1d4ed8', logoUrl: 'https://cdn.example.com/logo.png' } })
    expect(text).not.toContain('logo.png')
    expect(text).not.toContain('#1d4ed8')
    expect(text.startsWith('שלום דנה,')).toBe(true)
  })

  it('keeps AA for body copy on the surface it is painted on', () => {
    expect(contrastRatio('#18181b', '#ffffff')).toBeGreaterThanOrEqual(AA_NORMAL)
    expect(contrastRatio('#52525b', '#ffffff')).toBeGreaterThanOrEqual(AA_NORMAL)
    // Dark mode pair.
    expect(contrastRatio('#f4f4f5', '#232327')).toBeGreaterThanOrEqual(AA_NORMAL)
    expect(contrastRatio('#a1a1aa', '#232327')).toBeGreaterThanOrEqual(AA_NORMAL)
  })
})
