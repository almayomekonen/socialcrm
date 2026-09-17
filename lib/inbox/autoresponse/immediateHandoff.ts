/**
 * Explicit human-request handoff: no GPT, no Product Knowledge, no qualification.
 * Reuses the canonical handoff template and marks the conversation escalated.
 */
import { track } from '@/lib/analytics/track'
import { completeAutoResponseJob, skipAutoResponseJob, type AutoResponseJob } from '@/db/autoResponseJobs'
import { mergeOnly, markEscalated, type ConversationAiStateRow } from '@/db/conversationAiState'
import type { Qualification } from './qualification'
import { upsertManyConversationIntelligence, getMaxMessageSequence, INTEL_KIND_TEMPERATURE } from '@/db/conversationIntelligence'
import { insertQualifyDraftReview } from '@/db/qualifyDraftReview'
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { withGreeting } from './greeting'
import { buildSummary } from './summary'
import { detectLang, handoffMessage } from './qualify'
import { sendIreOutbound } from './ireSend'
import type { QualifyCtx } from './qualifyWorker'

async function persistEscalation(
  conversationId: number,
  agencyId: number,
  summary: { temperature: string; text: string; suggestedAction: string },
  q: Qualification,
): Promise<void> {
  const coveredSequence = await getMaxMessageSequence(conversationId)
  const base = {
    conversationId,
    agencyId,
    channel: 'whatsapp',
    status: 'fresh' as const,
    schemaVersion: 1,
    analyzerVersion: 'qualifier-v1',
    coveredSequence,
  }
  await upsertManyConversationIntelligence([
    { ...base, kind: INTEL_KIND_TEMPERATURE, data: { temperature: summary.temperature } },
    {
      ...base,
      kind: 'qualification_summary',
      data: {
        text: summary.text,
        suggestedAction: summary.suggestedAction,
        // Structured alongside the rendered note, so the staff surface can show
        // the fields without parsing a formatted blob.
        name: q.name ?? null,
        businessType: q.businessType ?? null,
        need: q.need ?? null,
        urgency: q.urgency ?? null,
        temperature: summary.temperature,
      },
    },
  ])
}

export async function runImmediateHumanHandoff(args: {
  job: AutoResponseJob
  ctx: QualifyCtx
  send: typeof sendWhatsappText
  aiState: ConversationAiStateRow
  lastInboundText: string
  /**
   * Set when this handoff is the FIRST thing the business ever says here — a
   * customer whose opening message is "can I talk to a person?" should still be
   * welcomed before being passed on. Null on every later turn.
   */
  greetingLine?: string | null
}): Promise<'sent' | 'skipped' | 'failed'> {
  const { job, ctx, send, aiState, lastInboundText } = args
  const lang = detectLang(lastInboundText)
  const reason = 'human_request'
  const handoffText = withGreeting(args.greetingLine ?? null, handoffMessage(reason, lang))
  const summary = buildSummary({
    qualification: aiState.qualification,
    reason,
    turnCount: aiState.aiTurnCount,
    lang,
  })

  if (ctx.settings.draft) {
    try {
      await insertQualifyDraftReview({
        conversationId: ctx.conv.id,
        agencyId: job.agencyId,
        decision: 'escalate',
        escalationReason: reason,
        replyText: handoffText,
        extracted: {},
        qualification: aiState.qualification,
        summary,
        lang,
        turnCount: aiState.aiTurnCount,
      })
    } catch (e) {
      console.error(`[IRE-DRAFT] persist failed conv=${ctx.conv.id}:`, (e as Error).message)
    }
    await skipAutoResponseJob(job.id, 'draft')
    await track({
      agencyId: job.agencyId,
      event: 'auto_response_draft',
      props: { conversationId: ctx.conv.id, decision: 'escalate' },
    })
    return 'skipped'
  }

  const r = await sendIreOutbound(job, ctx, send, handoffText)
  if (r.ok === false) {
    if (r.settled) return 'failed'
    await skipAutoResponseJob(job.id, r.reason)
    return 'skipped'
  }
  await mergeOnly(ctx.conv.id, {})
  await markEscalated(ctx.conv.id, reason)
  await persistEscalation(ctx.conv.id, job.agencyId, summary, args.aiState.qualification ?? {})
  await completeAutoResponseJob(job.id, r.messageId)
  console.log(`[IRE] qualify escalate conv=${ctx.conv.id} reason=${reason} temp=${summary.temperature} msg=${r.messageId}`)
  await track({
    agencyId: job.agencyId,
    event: 'auto_response_escalated',
    props: { conversationId: ctx.conv.id, reason },
  })
  return 'sent'
}
