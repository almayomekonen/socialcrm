import 'server-only'
import { db } from '@/config/db'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { REQUEST_WORDS } from '../request'
import { resolutionPhrase } from './resolve'

/**
 * A SmartBee card the owner has CHANGED their mind about is no longer approvable.
 *
 * The card binds the exact arguments (argsHash), and a NEW card supersedes it.
 * But a correction does not always produce a new card: "לא, 2000" after a ₪500
 * card may get a question back instead, and the ₪500 card would still be live.
 * So: when the owner writes a message that changes a document (an amount, a
 * type, a payment or VAT word, or a correction such as "לא" / "בעצם"; see
 * `changesDocument`) while a
 * document card is pending, that card is superseded before anything else runs.
 * Its buttons then answer "no longer valid, nothing issued".
 *
 * Small talk ("תודה", "רגע") leaves the card alone. Only this recipient's
 * pending document cards created before this message are touched; cards for
 * meetings, tasks or quotes are not. Never sends anything.
 */

/** VAT, payment and document words: the message speaks about a document's terms. */
const TERMS =
  /מע["״'׳]?מ|כולל|כלל|לפני|פלוס|מזומן|אשראי|כרטיס|העברה|צ['׳]ק|שיק|המחאה|ביט|פייבוקס|paybox|bit|תשלומ/iu
/** A correction or a change of mind. */
const CORRECTION = /(?<![\p{L}])(?:ו?לא|בעצם|טעות|טעיתי|תתקן|תקן|תשנה|במקום|סליחה)(?![\p{L}])/u
/** A number marked as money: "₪2000", "2000 ש"ח", "2000 שקל". */
const MONEY = /₪\s*\d|\d\s*(?:₪|ש["״'׳]?ח|שקל)/u
/** A message that is nothing but a number ("2000", "1,500", "1.5K"): an amount answer. */
const BARE_NUMBER = /^\s*\d[\d,.]*(?:\s*(?:אלף|אלפים|k))?[\s.!]*$/iu

/**
 * Does this message change a pending document? A document request word, a VAT
 * / payment / type word, a correction ("לא", "בעצם", …), a number marked as
 * money, or a message that is only a number. A number inside an unrelated
 * sentence ("כמה לידים היו ב-2025?") is not a change.
 *
 * The owner's answer about a STALLED document ("המסמך לא הופק", "המסמך הופק,
 * מספר 1045") is about that document, not the pending card: it never voids it,
 * though it contains "לא" and a number; only a money amount in it still does.
 */
export function changesDocument(text: string): boolean {
  // A stalled-document answer is not a change, unless it also names a new amount in money.
  if (resolutionPhrase(text)) return MONEY.test(text)
  return REQUEST_WORDS.document.test(text) || TERMS.test(text) || CORRECTION.test(text) || MONEY.test(text) || BARE_NUMBER.test(text)
}

/** Supersede this recipient's pending SmartBee document card when this message changes the document. Returns how many. */
export async function supersedeChangedDocumentCard(job: WaAssistantJob): Promise<number> {
  if (job.kind !== 'text' || !changesDocument(job.question ?? '')) return 0
  return db('wa_assistant_approvals')
    .where({ recipientId: job.recipientId, agencyId: job.agencyId, status: 'pending' })
    .where('jobId', '<', job.id)
    .whereIn('actionId', db('agent_actions').where({ agencyId: job.agencyId, actionType: 'create_smartbee_document' }).select('actionId'))
    .update({ status: 'superseded', updatedAt: db.fn.now() })
}
