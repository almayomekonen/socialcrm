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
 *   - an UNMARKED number can set the amount only in the message that opened
 *     the request, the answer to OUR amount question, or a message that
 *     corrects ("לא", "בעצם", "טעות", "תתקן", "במקום"). Anywhere else, such
 *     as "צילום 2 שעות" answering the description or "כולל 18" answering
 *     VAT, only a number marked as money (₪, ש"ח, שקל) counts. A bare number
 *     answering which lead, the check or the installments is that answer even
 *     in a correction;
 *   - in an amount answer or a correction, a number in a form we do not read
 *     ("1000000", "1500.5555") is a question: the older amount is never kept
 *     silently in its place;
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
/** "3 תשלומים", "2 פעמים", "2 שעות": a count, not money. */
const COUNT_AFTER = /^\s*(?:תשלומ|פעמים(?![\p{L}])|פעם(?![\p{L}])|שעות(?![\p{L}])|שעה(?![\p{L}])|דקות(?![\p{L}])|ימים(?![\p{L}]))/u
/** "צ'ק 1234", "אסמכתא 555", "ת.ז. 0123…", "טלפון 050…", "מספר 7": an identifier, not money. */
const IDENTIFIER_BEFORE =
  /(?:צ['׳]ק|שיק|המחאה|אסמכתא|אסמכתה|אישור|מספר|מס['׳]|ת\.?ז\.?|ת["״]ז|ח\.?פ\.?|ח["״]פ|ע\.?מ\.?|ע["״]מ|טלפון|טל['׳]|נייד|פלאפון|חשבון|סניף|כרטיס)\s*[:#-]?\s*(?:מספר|מס['׳]?)?\s*$/u
/** Part of a phone, date or time: "050-1234567", "12/11", "12.11.2026", "14:30". */
const JOINED_BEFORE = /[\d][-/:.]\s*$|\+\s*$/u
const JOINED_AFTER = /^\s*[-/:.]\s*\d/u

/** Questions whose bare-number answer is not an amount, even in a correction. */
const NOT_AMOUNT_ANSWER = /_clarify_(?:lead|check|installments)$/u
const AMOUNT_ANSWER = /_clarify_amount$/u
/** A message that corrects what was said. "לא כולל" is a VAT answer, not a correction. */
const CORRECTION = /(?<![\p{L}])(?:ו?לא(?![\p{L}])(?!\s*כולל)|בעצם|טעות|טעיתי|תתקן|תקן|במקום|סליחה)(?![\p{L}])/u

/**
 * How a message's numbers are read:
 *   - 'opening': unmarked numbers count; ones we cannot read are skipped;
 *   - 'stated': an amount answer or a correction; unmarked numbers count, and
 *     one we cannot read is a question;
 *   - 'money': only numbers marked as money count.
 */
type Reading = 'opening' | 'stated' | 'money'

function readingOf(turn: RequestTurn): Reading {
  if (!turn.answering) return 'opening'
  if (NOT_AMOUNT_ANSWER.test(turn.answering)) return 'money'
  return AMOUNT_ANSWER.test(turn.answering) || CORRECTION.test(turn.text) ? 'stated' : 'money'
}

type Candidate = { value: number; money: boolean } | 'unclear'

function candidates(text: string, reading: Reading): Candidate[] {
  const out: Candidate[] = []
  for (const m of text.matchAll(NUMBER)) {
    const before = text.slice(0, m.index)
    const after = text.slice(m.index + m[0].length)
    if (PERCENT_AFTER.test(after) || PERCENT_BEFORE.test(before) || COUNT_AFTER.test(after)) continue
    if (JOINED_BEFORE.test(before) || JOINED_AFTER.test(after)) continue
    const whole = m[1]
    const money = MONEY_AFTER.test(after) || MONEY_BEFORE.test(before)
    // "בכרטיס 1500 ש"ח" is money; "כרטיס 1500" or "צ'ק 1234" is a number of something.
    if (!money && IDENTIFIER_BEFORE.test(before)) continue
    if (reading === 'money' && !money) continue
    const thousands = !!m[3]
    const decimals = m[2]
    // "1.500" (thousands or a decimal?) is never guessed, wherever it appears.
    if (decimals?.length === 3) {
      out.push('unclear')
      continue
    }
    const plain = !whole.includes(',')
    // A long plain digit run or a leading zero (a phone, ID or account number), or more decimals than agorot.
    if ((plain && (whole.length >= 7 || (whole.length > 1 && whole.startsWith('0')))) || (decimals && decimals.length > 2)) {
      // Stated as the amount, it is a question; anywhere else it is something else.
      if (reading === 'stated' || money) out.push('unclear')
      continue
    }
    // A small decimal with no money mark ("12.11") is a date or a version, not a price.
    if (decimals && !money && !thousands && Number(whole.replace(/,/g, '')) < 100) {
      if (reading === 'stated') out.push('unclear')
      continue
    }
    const base = Number(`${whole.replace(/,/g, '')}${decimals ? `.${decimals}` : ''}`)
    const value = Math.round((thousands ? base * 1000 : base) * 100) / 100
    if (Number.isFinite(value) && value > 0) out.push({ value, money })
  }
  return out
}

/** The amount the owner stated, newest message first (request.ts order). */
export function statedDocumentAmount(turns: readonly RequestTurn[]): StatedAmount {
  for (const turn of turns) {
    const found = candidates(turn.text, readingOf(turn))
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
