import 'server-only'
import { findQuoteUnderReview } from '@/db/quotes/editQuote'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { prepareQuoteSendCard } from './preview'

/**
 * "תראה לי שוב את ההצעה" / "תשלח את ההצעה": the approve-and-send card again.
 * Deterministic and before the Agent, so it costs no request. A typed request to
 * send only ever produces this card: a customer send needs the button.
 */

const VERB = /(שוב|תראה|תראי|להראות|הראה|תציג|הצג|לראות|שלח|תשלח|תשלחי|לשלוח)/u
const QUOTE = /הצע(?:ת|ה|ות)/u
/** A new quote, or a change: those are the Agent's. */
const OTHER = /(תכין|להכין|הכן|ליצור|צור|חדשה|תשנה|לשנות|שנה|תעדכן|לעדכן|תוסיף|להוסיף|תוריד|להוריד|\d)/u

export const asksToReviewQuote = (text: string) => VERB.test(text) && QUOTE.test(text) && !OTHER.test(text)

export async function handleQuoteReviewMessage(input: { job: WaAssistantJob; scope: AgentScope; nowMs: number }): Promise<MeetingReply | null> {
  const { job, scope, nowMs } = input
  if (job.kind !== 'text' || !asksToReviewQuote(job.question?.trim() ?? '')) return null
  const quoteId = await findQuoteUnderReview({ agencyId: scope.agencyId, userId: scope.userId, recipientId: job.recipientId, now: new Date(nowMs) })
  if (quoteId == null) return null

  const card = await prepareQuoteSendCard({ agencyId: scope.agencyId, quoteId, scope, recipientId: job.recipientId, jobId: job.id, nowMs })
  if (card.kind !== 'card') return { status: 'answered', stopReason: card.stopReason, text: card.text, headline: null }
  return { status: 'answered', stopReason: 'quote_preview_offered', text: card.body, buttons: card.buttons, document: card.document, headline: 'ממתין לאישור שליחת הצעת מחיר' }
}
