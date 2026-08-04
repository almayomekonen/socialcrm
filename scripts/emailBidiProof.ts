/**
 * Automation-email bidi proof — real layout, real glyph positions.
 *
 * The CI contract (`__tests__/automations/emailShellContract.test.ts`) asserts
 * the CAUSE: that every text block carries a direction the email itself
 * declared. It runs in jsdom, which has no layout engine, so it cannot see the
 * EFFECT. This script closes that gap by measuring where characters actually
 * land, using the technique from the rendering audit:
 * `Range.getBoundingClientRect()` on individual glyphs in headless Chromium.
 *
 * Deliberately NOT part of the test suite — it needs a browser binary, and the
 * invariant it checks is already gated structurally. Run it when changing the
 * shell, and when verifying a deploy:
 *
 *   npx tsx scripts/emailBidiProof.ts
 *
 * A Hebrew paragraph is correct when its first letter sits at the RIGHT edge and
 * its sentence-final period sits at the LEFT edge — under BOTH host directions,
 * because the recipient's client UI language decides that, not the sender.
 */
import { chromium } from 'playwright'
import { renderAutomationEmail } from '../lib/automations/renderEmail'

const VARS = { leadFirstName: 'דנה', businessName: 'סטודיו אור', repName: 'יעל' }
const BODY = `שלום {{שם הליד}},

אם נוסף מידע שיכול לעזור לנו, או שיש שאלה — אפשר להשיב למייל הזה בכל שלב.

בברכה,
{{שם העסק}}`

const HOSTS = ['rtl', 'ltr'] as const

async function main() {
  const { html } = await renderAutomationEmail({
    subject: 'נושא',
    body: BODY,
    vars: VARS,
    unsubscribeUrl: 'https://app.example.com/api/automations/unsubscribe?a=1&l=2&t=t',
  })

  // What a re-hosting client (Gmail, Outlook.com, Yahoo) leaves us with: body
  // content only, inside ITS container, at ITS direction.
  const inner = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '')

  const browser = await chromium.launch()
  let failures = 0

  for (const host of HOSTS) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await page.setContent(
      `<!doctype html><html dir="${host}"><head><meta charset="utf-8"></head>` +
        `<body style="margin:0"><div dir="${host}" style="width:760px">${inner}</div></body></html>`,
    )

    // No inner named functions in here: the TS runner compiles this closure with
    // esbuild's keepNames, which injects a `__name` helper that does not exist in
    // the page context.
    const measured = await page.evaluate(() => {
      const out: { text: string; firstX: number; lastChar: string; lastX: number }[] = []
      for (const el of Array.prototype.slice.call(document.querySelectorAll('p')) as HTMLElement[]) {
        const whole = el.textContent ?? ''
        if (!/[֐-׿]/.test(whole) || !whole.trim().endsWith('.')) continue

        let node: ChildNode | null = null
        for (const candidate of Array.prototype.slice.call(el.childNodes) as ChildNode[]) {
          if (candidate.nodeType === 3 && (candidate.textContent ?? '').trim()) {
            node = candidate
            break
          }
        }
        if (!node) continue

        const text = node.textContent ?? ''
        const lastIndex = text.replace(/\s+$/, '').length - 1
        const first = document.createRange()
        first.setStart(node, 0)
        first.setEnd(node, 1)
        const last = document.createRange()
        last.setStart(node, lastIndex)
        last.setEnd(node, lastIndex + 1)

        out.push({
          text: text.trim(),
          firstX: Math.round(first.getBoundingClientRect().x),
          lastChar: text[lastIndex],
          lastX: Math.round(last.getBoundingClientRect().x),
        })
      }
      return out
    })

    console.log(`\n── host dir="${host}" ${'─'.repeat(40)}`)
    for (const m of measured) {
      // Correct RTL: the logically-first letter is rightmost, the final period
      // leftmost. If firstX < lastX the paragraph is being laid out LTR.
      const ok = m.firstX > m.lastX
      if (!ok) failures++
      console.log(
        `  ${ok ? 'PASS' : 'FAIL'}  first "${m.text[0]}" x=${m.firstX}  ` +
          `final "${m.lastChar}" x=${m.lastX}\n        ${m.text.slice(0, 62)}`,
      )
    }
    await page.close()
  }

  await browser.close()
  console.log(
    failures === 0
      ? '\nAll Hebrew paragraphs order correctly under both host directions.\n'
      : `\n${failures} paragraph(s) render backwards. The email is not carrying its own direction.\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
