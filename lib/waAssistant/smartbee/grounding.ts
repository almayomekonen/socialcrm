import type { PaymentMethod } from '@/lib/integrations/providers/smartbee/payload'
import type { SmartbeeDocType } from '@/lib/integrations/providers/smartbee/types'

/**
 * What did the OWNER say about a document? Pure. The model's proposal is only
 * a hint: the document type, the payment method, the check number and the
 * installments shown on the card are read from the owner's own messages here,
 * and anything not said becomes one question, never a guess.
 *
 * The amount and the VAT basis reuse the quote rules (../quotes/grounding.ts),
 * so "1,500", "1.5 אלף" and "כולל מע"מ" mean the same thing in both places.
 */

const HE = '\\u0590-\\u05FF'
const word = (core: string) => new RegExp(`(?<![${HE}])[הולב]?(?:${core})(?![${HE}])`, 'u')

const INVOICE = word('חשבונית|חשבוניות')
const RECEIPT = word('קבלה|קבלות')

export type StatedDocType = SmartbeeDocType | 'ambiguous' | null

/**
 * "חשבונית מס קבלה", "חשבונית/קבלה" or "חשבונית וקבלה" → InvoiceReceipt (one
 * combined document); "חשבונית" alone → Invoice; "קבלה" alone → Receipt. The
 * newest message that names a type decides, as in a conversation.
 */
export function statedDocType(said: readonly string[]): StatedDocType {
  for (const text of said) {
    const inv = INVOICE.test(text)
    const rec = RECEIPT.test(text)
    if (inv && rec) return 'InvoiceReceipt'
    if (inv) return 'Invoice'
    if (rec) return 'Receipt'
  }
  return null
}

const METHODS: readonly [PaymentMethod, RegExp][] = [
  ['cash', word('מזומן|מזומנים')],
  ['credit_card', word('אשראי|כרטיס|כרטיס אשראי')],
  ['bank_transfer', word('העברה|העברה בנקאית|העברת בנק')],
  ['check', new RegExp(`(?<![${HE}])[הולב]?(?:צ['׳]ק|צ['׳]קים|שיק|שיקים|המחאה)(?![${HE}])`, 'u')],
  ['other', /(?<![֐-׿\p{L}])(?:[בו]?ביט|bit|[בו]?פייבוקס|[בו]?פיי בוקס|paybox)(?![֐-׿\p{L}])/iu],
]

export type StatedPayment = { method: PaymentMethod; otherLabel: string | null } | 'ambiguous' | null

/** The ONE payment method the owner named. Two different methods is a question, not a split receipt. */
export function statedPaymentMethod(said: readonly string[]): StatedPayment {
  for (const text of said) {
    const found = METHODS.filter(([, re]) => re.test(text)).map(([m]) => m)
    if (found.length > 1) return 'ambiguous'
    if (found.length === 1) {
      const method = found[0]
      if (method !== 'other') return { method, otherLabel: null }
      return { method, otherLabel: /פיי ?בוקס|paybox/iu.test(text) ? 'פייבוקס' : 'ביט' }
    }
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
