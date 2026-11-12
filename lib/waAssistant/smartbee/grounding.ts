import type { PaymentMethod } from '@/lib/integrations/providers/smartbee/payload'
import type { SmartbeeDocType } from '@/lib/integrations/providers/smartbee/types'
import type { RequestTurn } from '../request'
import { statedBasis, type StatedBasis } from '../quotes/grounding'

/**
 * What did the OWNER say about a document? Pure. The model's proposal is only
 * a hint: the document type, the payment method, the check number and the
 * installments shown on the card are read from the owner's own messages here,
 * and anything not said becomes one question, never a guess.
 *
 * Each reader takes the request newest first. A message may carry the question
 * it answered (request.ts `RequestTurn`): a bare answer counts only for the
 * question that was asked, and a typo is accepted only there. The amount is
 * read by ./amount.ts; a free VAT sentence by the quote rules.
 */

const HE = '\\u0590-\\u05FF'

export type StatedDocType = SmartbeeDocType | 'ambiguous' | null

/** A message, optionally with the question it answered (request.ts `RequestTurn`). A plain string answered nothing. */
type Said = string | RequestTurn
const asTurn = (s: Said): RequestTurn => (typeof s === 'string' ? { text: s, answering: null } : s)
const answering = (s: RequestTurn, what: string) => s.answering?.endsWith(`_clarify_${what}`) ?? false

/** "לא קבלה", "ולא חשבונית", "בלי קבלה": the word right before a mention negates it. "לא, קבלה" does not. */
const NEGATED_BEFORE = /(?:^|[^\p{L}])(?:לא|ולא|בלי|ללא|במקום)\s*$/u
const negated = (text: string, index: number) => NEGATED_BEFORE.test(text.slice(0, index))

const COMBINED = new RegExp(`(?<![${HE}])[הולב]?חשבונית(?:\\s+מס)?\\s*(?:[/+]|\\s)\\s*ו?קבלה(?![${HE}])`, 'gu')
const INVOICE = new RegExp(`(?<![${HE}])[הולב]?(?:חשבונית|חשבוניות)(?:\\s+מס)?(?![${HE}])`, 'gu')
const RECEIPT = new RegExp(`(?<![${HE}])[הולב]?(?:קבלה|קבלות)(?![${HE}])`, 'gu')

/**
 * The document type in ONE message. "חשבונית מס קבלה", "חשבונית/קבלה" and
 * "חשבונית וקבלה" are the combined document; a negated mention does not count
 * ("לא חשבונית, קבלה" → Receipt; "לא קבלה, חשבונית מס" → Invoice). Two
 * different types that are not one combined phrase is a question. A message that
 * only negates ("לא קבלה") states no type, and nothing older is used instead.
 */
function docTypeIn(text: string): StatedDocType | 'none' {
  const kinds = new Set<SmartbeeDocType>()
  let mentioned = false
  let rest = text
  for (const m of text.matchAll(COMBINED)) {
    mentioned = true
    if (!negated(text, m.index)) kinds.add('InvoiceReceipt')
    // The combined phrase is not also an invoice and a receipt.
    rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length)
  }
  for (const [re, kind] of [
    [INVOICE, 'Invoice'],
    [RECEIPT, 'Receipt'],
  ] as const) {
    for (const m of rest.matchAll(re)) {
      mentioned = true
      if (!negated(rest, m.index)) kinds.add(kind)
    }
  }
  if (!mentioned) return 'none'
  if (kinds.size === 1) return [...kinds][0]
  return kinds.size > 1 ? 'ambiguous' : null
}

/** The newest message that names a type decides, as in a conversation. */
export function statedDocType(said: readonly Said[]): StatedDocType {
  for (const s of said) {
    const t = docTypeIn(asTurn(s).text)
    if (t !== 'none') return t
  }
  return null
}

const METHOD_WORDS: readonly [PaymentMethod, string][] = [
  ['cash', 'מזומנים|מזומן'],
  ['credit_card', 'כרטיס אשראי|אשראי|כרטיס'],
  ['bank_transfer', 'העברה בנקאית|העברת בנק|העברה'],
  ['check', "צ['׳]קים|צ['׳]ק|שיקים|שיק|המחאה"],
  ['other', 'ביט|bit|פייבוקס|פיי בוקס|paybox'],
]
const METHOD = new RegExp(`(?<![${HE}\\p{L}])([הולב]-?)?(${METHOD_WORDS.map(([, w]) => w).join('|')})(?![${HE}\\p{L}])`, 'giu')
const methodOf = (word: string): PaymentMethod => METHOD_WORDS.find(([, w]) => new RegExp(`^(?:${w})$`, 'iu').test(word))![0]
/** Words that make a sentence a statement about payment ("שולם", "שילמתי", "התקבל"). */
const PAID = /(?:^|[^\p{L}])(?:שולם|שולמה|שולמו|שילם|שילמה|שילמו|שילמתי|שילמנו|שילמת|תשלום|התשלום|התקבל|התקבלו|קיבלתי|קיבלנו|העביר|העבירה|העבירו)(?![\p{L}])/u

export type StatedPayment = { method: PaymentMethod; otherLabel: string | null } | 'ambiguous' | null

/**
 * The payment method in ONE message, or 'none' when the message says nothing
 * about payment. A method word counts only as a statement about payment: the
 * answer to OUR payment question, the word with ב ("במזומן", "בביט"), a
 * sentence saying it was paid ("שולם", "שילמתי"), or a correction ("לא מזומן,
 * אשראי"). "קבלה על כרטיס להופעה" and "הסעה והעברה לשדה" say nothing about
 * payment. A negated method is not the method.
 */
function paymentIn(turn: RequestTurn): StatedPayment | 'none' {
  const text = turn.text
  const found = [...text.matchAll(METHOD)].map((m) => ({ method: methodOf(m[2]), word: m[2], by: (m[1] ?? '').startsWith('ב'), negated: negated(text, m.index) }))
  if (!found.length) return 'none'
  const statement = answering(turn, 'payment') || PAID.test(text) || found.some((f) => f.negated)
  const counted = found.filter((f) => statement || f.by)
  if (!counted.length) return 'none'
  const methods = [...new Set(counted.filter((f) => !f.negated).map((f) => f.method))]
  if (methods.length > 1) return 'ambiguous'
  // Only a negation ("לא מזומן"): no method was stated, and an older one is not revived.
  if (!methods.length) return null
  const method = methods[0]
  if (method !== 'other') return { method, otherLabel: null }
  const word = counted.find((f) => f.method === 'other' && !f.negated)!.word
  return { method, otherLabel: /פיי ?בוקס|paybox/iu.test(word) ? 'פייבוקס' : 'ביט' }
}

/** The ONE payment method the owner stated; the newest message that speaks about payment decides. Two methods is a question. */
export function statedPaymentMethod(said: readonly Said[]): StatedPayment {
  for (const s of said) {
    const p = paymentIn(asTurn(s))
    if (p !== 'none') return p
  }
  return null
}

const VAT_WORD = `(?:\\s*(?:את\\s*)?(?:ה)?מע["״'׳]?מ)?`
/** Answering OUR VAT question only: "כולל" and its common typos. */
const ANSWER_INCL = new RegExp(`^\\s*(?:כן\\s*,?\\s*)?(?:כולל|כלל|כוללל|כלול|כולל\\s+הכל|כולל\\s+הכול)${VAT_WORD}[\\s.!]*$`, 'u')
/** Answering OUR VAT question: "לפני" (before VAT) and "פלוס"/"בתוספת" (VAT on top) both mean the price excludes VAT. */
const ANSWER_EXCL = new RegExp(`^\\s*(?:לפני|פלוס|\\+|בתוספת|ועוד|לא\\s+כולל)${VAT_WORD}[\\s.!]*$`, 'u')
/** "בלי" / "ללא" answers neither option of "כולל מע"מ או לפני מע"מ?" (no VAT? before VAT?): asked again. */
const ANSWER_UNCLEAR = new RegExp(`^\\s*(?:בלי|ללא)${VAT_WORD}[\\s.!]*$`, 'u')

/**
 * The VAT basis the owner stated, newest first. A free sentence is read by the
 * quote rules (../quotes/grounding.ts). The answer to OUR VAT question also
 * accepts a typo like "כלל", and only there; "בלי" there is asked again.
 */
export function statedVat(said: readonly Said[]): StatedBasis {
  for (const s of said) {
    const turn = asTurn(s)
    if (answering(turn, 'vat')) {
      if (ANSWER_INCL.test(turn.text)) return 'incl_vat'
      if (ANSWER_EXCL.test(turn.text)) return 'excl_vat'
      if (ANSWER_UNCLEAR.test(turn.text)) return null
    }
    const b = statedBasis([turn.text])
    if (b) return b
  }
  return null
}

/** "צ'ק מספר 1234" / "שיק 1234" → "1234". Only a number the owner wrote. */
export function statedCheckNumber(said: readonly string[]): string | null {
  const re = new RegExp(`(?:צ['׳]ק|שיק|המחאה)\\s*(?:מספר|מס['׳]?)?\\s*(\\d{1,25})(?!\\d)`, 'u')
  for (const text of said) {
    const m = re.exec(text)
    if (m) return m[1]
  }
  return null
}

/** "ב-3 תשלומים" → 3. Absent → null (one payment). */
export function statedInstallments(said: readonly string[]): number | null {
  for (const text of said) {
    const m = /(\d{1,2})\s*תשלומים/u.exec(text)
    if (m) return Number(m[1])
  }
  return null
}

/** "אסמכתא 55512" → "55512". Optional for a transfer. */
export function statedTransferReference(said: readonly string[]): string | null {
  for (const text of said) {
    const m = /אסמכתא\s*(?:מספר)?\s*([A-Za-z0-9-]{1,25})/u.exec(text)
    if (m) return m[1]
  }
  return null
}

/** The description is the owner's, not the model's: at least one of its words was said. */
export function descriptionGrounded(description: string | null, said: readonly string[]): boolean {
  if (!description || !description.trim()) return false
  const text = said.join(' ')
  return description
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length >= 2)
    .some((w) => text.includes(w))
}
