import 'server-only'
import { db } from '@/config/db'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { REQUEST_WORDS } from '../request'

/**
 * A SmartBee card the owner has CHANGED their mind about is no longer approvable.
 *
 * The card binds the exact arguments (argsHash), and a NEW card supersedes it.
 * But a correction does not always produce a new card: "לא, 2000" after a ₪500
 * card may get a question back instead, and the ₪500 card would still be live.
 * So: when the owner writes a message that changes a document (an amount, a
 * type, a payment or VAT word, or a correction such as "לא" / "בעצם") while a
 * document card is pending, that card is superseded before anything else runs.
 * Its buttons then answer "no longer valid, nothing issued".
 *
 * Small talk ("תודה", "רגע") leaves the card alone. Only this recipient's
 * pending document cards created before this message are touched; cards for
 * meetings, tasks or quotes are not. Never sends anything.
 */

const MATERIAL =
  /\d|מע["״'׳]?מ|כולל|כלל|לפני|פלוס|מזומן|אשראי|כרטיס|העברה|צ['׳]ק|שיק|המחאה|ביט|פייבוקס|paybox|bit|תשלומ|(?:^|[^\p{L}])(?:לא|בעצם|טעות|תתקן|תשנה|במקום|סליחה)(?![\p{L}])/iu

export function changesDocument(text: string): boolean {
  return MATERIAL.test(text) || REQUEST_WORDS.document.test(text)
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
