/**
 * Is every number on a quote card one the OWNER said? Pure.
 *
 * The model reads "18,500 שקל כולל מע"מ" and fills the proposal; this file
 * checks the proposal against the owner's own messages (the request, newest
 * first, as request.ts replays it) so a price, quantity, discount, validity or
 * VAT basis the model produced on its own never reaches a card. A failed check
 * becomes ONE question to the owner, never a guess (care charter, Law 1).
 *
 * Deliberately narrow: digits (with thousands separators and decimals), "אלף"
 * ("18.5 אלף"), and a percent written with digits ("10%", "%10", "10 אחוז").
 * Spelled-out Hebrew numbers are NOT read, so they fail toward a question rather
 * than toward a number nobody said.
 */

export type StatedBasis = 'incl_vat' | 'excl_vat' | 'ambiguous' | null

const NUMBER = /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d])(\s*(?:אלף|אלפים|אל"ף|k|K)(?![\p{L}]))?/gu
const round2 = (n: number) => Math.round(n * 100) / 100
const PERCENT_AFTER = /^\s*(?:%|אחוז(?:ים)?(?![\p{L}]))/u
const PERCENT_BEFORE = /%\s*$/u
const PERCENT = /(?<![\d.,])(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|אחוז(?:ים)?(?![\p{L}]))|%\s*(\d{1,3}(?:\.\d{1,2})?)(?![\d.,])/gu

/**
 * Every amount written in the owner's messages, including "18.5 אלף" as 18,500.
 * A number written as a percent is not an amount: "10%" must never ground a ₪10 discount.
 */
export function statedAmounts(said: readonly string[]): number[] {
  const out = new Set<number>()
  for (const text of said) {
    for (const m of text.matchAll(NUMBER)) {
      if (PERCENT_AFTER.test(text.slice(m.index + m[0].length)) || PERCENT_BEFORE.test(text.slice(0, m.index))) continue
      const base = Number(`${m[1].replace(/,/g, '')}${m[2] ? `.${m[2]}` : ''}`)
      if (!Number.isFinite(base)) continue
      out.add(round2(base))
      if (m[3]) out.add(round2(base * 1000))
    }
  }
  return [...out]
}

/** Every percent written with digits in the owner's messages. */
export function statedPercents(said: readonly string[]): number[] {
  const out = new Set<number>()
  for (const text of said) for (const m of text.matchAll(PERCENT)) out.add(Number(m[1] ?? m[2]))
  return [...out].filter((p) => p > 0 && p <= 100)
}

export const isStated = (value: number, amounts: readonly number[]) => amounts.some((a) => Math.abs(a - value) < 0.005)

export type ProposedLine = { title: string; quantity: number | null; unitAmount: number | null; discountAmount: number | null; discountPercent?: number | null }

const NO_DISCOUNT = /(?:בלי|ללא|בלא|אין)\s+(?:שום\s+)?הנח/u
const DISCOUNT = /(?<![\p{L}])[ובלה]?הנח[הת](?![\p{L}])/u

/** Did the owner ask for a discount? The newest message that speaks about one decides ("בלי הנחה" answers our question). */
export function discountRequested(said: readonly string[]): boolean {
  for (const text of said) {
    if (NO_DISCOUNT.test(text)) return false
    if (DISCOUNT.test(text)) return true
  }
  return false
}

/**
 * A line's price is grounded when the owner said it per unit, or said the
 * line's whole amount ("3 חלונות ב-3,000"). A quantity other than 1, and any
 * discount (as an amount or as a percent), must be said too. A stated percent
 * wins over any amount beside it: the application computes that amount itself.
 */
export function lineGrounded(l: ProposedLine, amounts: readonly number[], percents: readonly number[] = []): boolean {
  const qty = l.quantity ?? 1
  if (l.unitAmount == null) return false
  if (qty !== 1 && !isStated(qty, amounts)) return false
  if (!isStated(l.unitAmount, amounts) && !isStated(round2(l.unitAmount * qty), amounts)) return false
  if (l.discountPercent != null && l.discountPercent !== 0) return isStated(l.discountPercent, percents)
  if (l.discountAmount != null && l.discountAmount !== 0 && !isStated(l.discountAmount, amounts)) return false
  return true
}

const VAT = `(?:ה)?מע["״'׳]?מ`
const EXCL = new RegExp(`(?:לפני|ללא|בלי|לא\\s+כולל|פלוס|\\+|ועוד|בתוספת)\\s*${VAT}`, 'u')
const INCL = new RegExp(`כולל\\s*(?:את\\s*)?${VAT}`, 'u')
const BARE_INCL = /^\s*(?:כן\s*,?\s*)?כולל[\s.!]*$/u
const BARE_EXCL = /^\s*(?:לפני|ללא|בלי|לא\s+כולל|פלוס|בתוספת)[\s.!]*$/u

function basisOf(text: string): StatedBasis {
  const excl = EXCL.test(text) || BARE_EXCL.test(text)
  // "לא כולל מע"מ" also contains "כולל מע"מ": judge inclusion with the exclusions removed.
  const incl = INCL.test(text.replace(new RegExp(EXCL.source, 'gu'), ' ')) || BARE_INCL.test(text)
  if (incl && excl) return 'ambiguous'
  return incl ? 'incl_vat' : excl ? 'excl_vat' : null
}

/** The VAT basis the owner stated: the newest message that states one decides. */
export function statedBasis(said: readonly string[]): StatedBasis {
  for (const text of said) {
    const b = basisOf(text)
    if (b) return b
  }
  return null
}

const WORD_DAYS: [RegExp, number][] = [
  [/שבועיים/u, 14],
  [/(?<![\p{L}])[לב]?שבוע(?![\p{L}])/u, 7],
  [/חודשיים/u, 60],
  [/(?<![\p{L}])[לב]?חודש(?![\p{L}])/u, 30],
  [/(?:3|שלושה)\s*חודשים/u, 90],
]

/** The validity the owner stated is exactly `days` ("30 יום", "שבועיים", "לחודש"). */
export function validityStated(days: number, said: readonly string[]): boolean {
  const text = said.join('\n')
  if (new RegExp(`(?<![\\d])${days}\\s*(?:יום|ימים|ימי)`, 'u').test(text)) return true
  return WORD_DAYS.some(([re, d]) => d === days && re.test(text))
}
