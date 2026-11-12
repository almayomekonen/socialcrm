import type { RequestTurn } from '../request'

/**
 * THE AMOUNT of a SmartBee document, read from the owner's own messages. Pure.
 *
 * The model's number is never used: the card and the payload carry the number
 * this returns. Rules, in order:
 *   - the NEWEST message that states an amount decides ("500", then "לא, 2000"
 *     → 2000 only);
 *   - a number that is something else is not an amount: a check, reference, ID,
 *     phone or account number, installments ("3 תשלומים"), a percent, a date or
 *     a time;
 *   - a bare number answering a question about something else (which lead, the
 *     check number, the installments) is that answer, not an amount; only a
 *     number marked as money (₪, ש"ח, שקל) counts there;
 *   - two different amounts in the deciding message, and none marked as money,
 *     is a question, never a choice;
 *   - "1,500", "1500", "₪1500", "1500 ש"ח" → 1500; "1.5K" / "1.5 אלף" → 1500
 *     only; "1.500" (thousands or decimals?) is a question; spelled-out Hebrew
 *     numbers are not read at all.
 */

export type StatedAmount = { amount: number } | 'ambiguous' | null

const NUMBER = /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![\d])(\s*(?:אלף|אלפים|k)(?![\p{L}]))?/giu
const MONEY_AFTER = /^\s*(?:₪|ש["״'׳]?ח|שקל(?:ים)?|nis)(?![\p{L}])/iu
const MONEY_BEFORE = /(?:₪|nis)\s*$/iu
const PERCENT_AFTER = /^\s*(?:%|אחוז(?:ים)?(?![\p{L}]))/u
const PERCENT_BEFORE = /%\s*$/u
const INSTALLMENTS_AFTER = /^\s*תשלומ/u
/** "צ'ק 1234", "אסמכתא 555", "ת.ז. 0123…", "טלפון 050…", "מספר 7": an identifier, not money. */
const IDENTIFIER_BEFORE =
  /(?:צ['׳]ק|שיק|המחאה|אסמכתא|אסמכתה|אישור|מספר|מס['׳]|ת\.?ז\.?|ת["״]ז|ח\.?פ\.?|ח["״]פ|ע\.?מ\.?|ע["״]מ|טלפון|טל['׳]|נייד|פלאפון|חשבון|סניף|כרטיס)\s*[:#-]?\s*(?:מספר|מס['׳]?)?\s*$/u
/** Part of a phone, date or time: "050-1234567", "12/11", "12.11.2026", "14:30". */
const JOINED_BEFORE = /[\d][-/:.]\s*$|\+\s*$/u
const JOINED_AFTER = /^\s*[-/:.]\s*\d/u

/** Questions whose bare-number answer is not an amount. */
const NOT_AMOUNT_ANSWER = /_clarify_(?:lead|check|installments)$/u

type Candidate = { value: number; money: boolean } | 'unclear'

function candidates(text: string, moneyOnly: boolean): Candidate[] {
  const out: Candidate[] = []
  for (const m of text.matchAll(NUMBER)) {
    const before = text.slice(0, m.index)
    const after = text.slice(m.index + m[0].length)
    if (PERCENT_AFTER.test(after) || PERCENT_BEFORE.test(before) || INSTALLMENTS_AFTER.test(after)) continue
    if (JOINED_BEFORE.test(before) || JOINED_AFTER.test(after)) continue
    const whole = m[1]
    const plain = !whole.includes(',')
    // A long plain digit run, or one with a leading zero, is a phone, ID or account number.
    if (plain && (whole.length >= 7 || (whole.length > 1 && whole.startsWith('0')))) continue
    const money = MONEY_AFTER.test(after) || MONEY_BEFORE.test(before)
    // "בכרטיס 1500 ש"ח" is money; "כרטיס 1500" or "צ'ק 1234" is a number of something.
    if (!money && IDENTIFIER_BEFORE.test(before)) continue
    const thousands = !!m[3]
    if (moneyOnly && !money) continue
    const decimals = m[2]
    // "1.500": thousands or a decimal? Never guessed.
    if (decimals && decimals.length === 3 && !thousands) {
      out.push('unclear')
      continue
    }
    if (decimals && decimals.length > 2) continue
    // A small decimal with no money mark ("12.11") is a date or a version, not a price.
    if (decimals && !money && !thousands && Number(whole.replace(/,/g, '')) < 100) continue
    const base = Number(`${whole.replace(/,/g, '')}${decimals ? `.${decimals}` : ''}`)
    const value = Math.round((thousands ? base * 1000 : base) * 100) / 100
    if (Number.isFinite(value) && value > 0) out.push({ value, money })
  }
  return out
}

/** The amount the owner stated, newest message first (request.ts order). */
export function statedDocumentAmount(turns: readonly RequestTurn[]): StatedAmount {
  for (const turn of turns) {
    const found = candidates(turn.text, !!turn.answering && NOT_AMOUNT_ANSWER.test(turn.answering))
    if (!found.length) continue
    if (found.includes('unclear')) return 'ambiguous'
    const values = found as { value: number; money: boolean }[]
    const distinct = (list: { value: number }[]) => [...new Set(list.map((c) => c.value))]
    const all = distinct(values)
    if (all.length === 1) return { amount: all[0] }
    // Several numbers: the one marked as money, if exactly one is.
    const money = distinct(values.filter((c) => c.money))
    return money.length === 1 ? { amount: money[0] } : 'ambiguous'
  }
  return null
}
