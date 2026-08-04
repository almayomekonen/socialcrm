import { describe, expect, it } from 'vitest'
import { renderAutomationEmail } from '@/lib/automations/renderEmail'
import {
  APPLE_MAIL,
  BEST_EFFORT_CLIENTS,
  FIRST_CLASS_CLIENTS,
  declared,
  deliver,
  emailDeclaresDir,
  firstStrongDirection,
} from './support/mailClients'

/**
 * THE RENDERING CONTRACT for customer-automation email (System B only —
 * platform/lifecycle email is a different system and is not covered here).
 *
 * These are invariants, not snapshots: each one states a property the email must
 * have in a recipient's client, and names the audit finding it closes. They are
 * written to FAIL on the pre-Phase-1 renderer, so the fix is driven by a red
 * test rather than by eyeballing an inbox.
 *
 * Every assertion runs against each first-class client profile, because the
 * whole class of bug being fixed here is "correct in the sender's client,
 * broken in the recipient's".
 */

const VARS = { leadFirstName: 'דנה', businessName: 'סטודיו אור', repName: 'יעל' }
const UNSUBSCRIBE = 'https://app.example.com/api/automations/unsubscribe?a=7&l=42&t=tok'

const HEBREW_BODY = `שלום {{שם הליד}},

תודה שפנית אלינו. הפנייה שלך התקבלה והיא כבר אצלנו.

בברכה,
{{שם העסק}}`

const render = (body: string, subject = 'נושא הבדיקה') =>
  renderAutomationEmail({ subject, body, vars: VARS, unsubscribeUrl: UNSUBSCRIBE })

describe('email rendering contract — direction survives the client (RTL-1, RTL-2, GML-1)', () => {
  for (const client of FIRST_CLASS_CLIENTS) {
    it(`resolves every Hebrew text block to RTL in ${client.name}`, async () => {
      const { html } = await render(HEBREW_BODY)
      const { textBlocks, effectiveDir } = deliver(html, client)

      expect(textBlocks.length).toBeGreaterThan(0)
      for (const block of textBlocks) {
        const content = block.textContent ?? ''
        if (firstStrongDirection(content) !== 'rtl') continue
        expect(
          effectiveDir(block),
          `Hebrew block resolved LTR in ${client.name}: ${JSON.stringify(content.slice(0, 40))}`,
        ).toBe('rtl')
      }
    })

    it(`does not use text-align as a stand-in for direction in ${client.name}`, async () => {
      const { html } = await render(HEBREW_BODY)
      const { textBlocks, hostContainer } = deliver(html, client)

      for (const block of textBlocks) {
        if (declared(block, 'text-align') !== 'right') continue
        // A right-aligned block must carry a direction the EMAIL declared —
        // alignment moves the box, it does not reorder bidi runs. The client
        // container's own `dir` does not count, or this could never fail.
        expect(
          emailDeclaresDir(block, hostContainer),
          `text-align:right with no email-declared dir in ${client.name}`,
        ).toBe(true)
      }
    })
  }

  it('follows the content when the customer writes LTR copy (RTL-3)', async () => {
    const { html } = await render('Hi Dana,\n\nThanks for reaching out.\n\nBest,\nStudio Or')
    for (const client of FIRST_CLASS_CLIENTS) {
      const { textBlocks, effectiveDir } = deliver(html, client)
      const english = textBlocks.filter((b) => firstStrongDirection(b.textContent ?? '') === 'ltr')
      expect(english.length).toBeGreaterThan(0)
      for (const block of english) {
        expect(effectiveDir(block), `English copy forced RTL in ${client.name}`).toBe('ltr')
        expect(declared(block, 'text-align')).not.toBe('right')
      }
    }
  })
})

describe('email rendering contract — line breaks are markup, not styling (SIG-1, SIG-4)', () => {
  const clients = [...FIRST_CLASS_CLIENTS, ...BEST_EFFORT_CLIENTS]

  for (const client of clients) {
    it(`keeps the multi-line signature broken in ${client.name}`, async () => {
      const { html } = await render(HEBREW_BODY)
      const { root } = deliver(html, client)

      // `בברכה,` and the business name are separate lines in the source, so the
      // rendered email must contain real break markup — a `white-space`
      // declaration is not a line break in clients that drop it.
      expect(root.querySelectorAll('br').length, `no <br> survived in ${client.name}`).toBeGreaterThan(0)
    })
  }

  it('preserves the signature in the plain-text alternative (UX-7)', async () => {
    const { text } = await render(HEBREW_BODY)
    expect(text).toContain('בברכה,\nסטודיו אור')
  })

  it('keeps a single-newline body as separate lines (SIG-4)', async () => {
    const { html } = await render('שלום דנה,\nתודה שפנית.\nבברכה,\nסטודיו אור')
    const { root } = deliver(html, BEST_EFFORT_CLIENTS[0])
    expect(root.querySelectorAll('br').length).toBeGreaterThanOrEqual(3)
  })
})

describe('email rendering contract — typography is declared, never inherited (TYP-1..TYP-5)', () => {
  const REQUIRED = ['color', 'font-family', 'font-size', 'line-height'] as const

  for (const client of FIRST_CLASS_CLIENTS) {
    it(`declares the full type stack on every text block in ${client.name}`, async () => {
      const { html } = await render(HEBREW_BODY)
      const { textBlocks } = deliver(html, client)

      for (const block of textBlocks) {
        for (const property of REQUIRED) {
          expect(
            declared(block, property),
            `${property} missing on <${block.tagName.toLowerCase()}> in ${client.name}`,
          ).not.toBe('')
        }
      }
    })
  }

  it('uses unit-bearing line-height (Outlook ignores unitless) (TYP-5)', async () => {
    const { html } = await render(HEBREW_BODY)
    const { textBlocks } = deliver(html, FIRST_CLASS_CLIENTS[0])
    for (const block of textBlocks) {
      const lh = declared(block, 'line-height')
      expect(lh, `unitless line-height "${lh}"`).toMatch(/(px|em|rem|%)$/)
    }
  })

  it('declares a color scheme so dark mode is not left to the client (TYP-1, GML-4)', async () => {
    const { html } = await render(HEBREW_BODY)
    expect(html).toMatch(/name="color-scheme"|color-scheme:/i)
    expect(html).toMatch(/supported-color-schemes/i)
  })

  it('sets a body font size of at least 16px (TYP-4)', async () => {
    const { html } = await render(HEBREW_BODY)
    const { textBlocks } = deliver(html, FIRST_CLASS_CLIENTS[0])
    const greeting = textBlocks.find((b) => (b.textContent ?? '').startsWith('שלום'))
    expect(greeting).toBeDefined()
    expect(parseInt(declared(greeting!, 'font-size'), 10)).toBeGreaterThanOrEqual(16)
  })
})

describe('email rendering contract — spacing is portable (SPC-1, SPC-2)', () => {
  const clients = [...FIRST_CLASS_CLIENTS, ...BEST_EFFORT_CLIENTS]

  for (const client of clients) {
    it(`never relies on margin collapsing in ${client.name}`, async () => {
      const { html } = await render(HEBREW_BODY)
      const { root } = deliver(html, client)

      // Both-direction margins collapse in browsers and DO NOT in Outlook, so
      // the same email gets two different rhythms. One direction only.
      for (const el of root.querySelectorAll<HTMLElement>('[style]')) {
        const top = parseFloat(declared(el, 'margin-top') || '0')
        const bottom = parseFloat(declared(el, 'margin-bottom') || '0')
        expect(
          top > 0 && bottom > 0,
          `<${el.tagName.toLowerCase()}> sets margin-top AND margin-bottom in ${client.name}`,
        ).toBe(false)
      }
    })

  }

  // Not per-client: this is a property of the markup we emit. Asserting it after
  // simulation would pass vacuously for the Word engine, which strips the very
  // declaration under test.
  it('puts padding on cells, never on tables (SPC-2)', async () => {
    const { html } = await render(HEBREW_BODY)
    const { root } = deliver(html, APPLE_MAIL)
    const tables = root.querySelectorAll<HTMLElement>('table[style]')
    expect(tables.length).toBeGreaterThan(0)
    for (const table of tables) {
      expect(declared(table, 'padding'), 'padding on <table> is ignored by the Word engine').toBe('')
    }
  })
})

describe('email rendering contract — mobile and overflow (RSP-1, RSP-3)', () => {
  it('declares a viewport (RSP-1)', async () => {
    const { html } = await render(HEBREW_BODY)
    expect(html).toMatch(/name="viewport"/i)
  })

  it('lets a long URL wrap instead of forcing overflow (RSP-3)', async () => {
    const long = 'https://example.co.il/very/long/path/that/never/breaks/anywhere?utm_source=automation&utm_campaign=x'
    const { html } = await render(`שלום,\n\nהפרטים כאן: ${long}`)
    const { textBlocks } = deliver(html, FIRST_CLASS_CLIENTS[0])
    const block = textBlocks.find((b) => (b.textContent ?? '').includes('example.co.il'))
    expect(block).toBeDefined()
    const wraps = declared(block!, 'overflow-wrap') || declared(block!, 'word-break') || declared(block!, 'word-wrap')
    expect(wraps, 'no wrapping rule on a block that can hold an unbreakable URL').not.toBe('')
  })
})
