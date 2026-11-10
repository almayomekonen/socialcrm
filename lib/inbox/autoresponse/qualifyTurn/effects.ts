/**
 * Side effects shared by the qualify turn: send + persist, shadow qualification, escalation record.
 *
 * Part of the qualify turn (../qualifyWorker.ts), moved out unchanged so the
 * orchestrator stays reviewable (architecture-rules §1, §5). Behaviour-preserving:
 * the statements are the original ones, in the original order.
 */
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { type AutoResponseJob } from '@/db/autoResponseJobs'
import { upsertManyConversationIntelligence, getMaxMessageSequence, INTEL_KIND_TEMPERATURE } from '@/db/conversationIntelligence'
import { isPositiveLeadId } from '../contactJob'
import { type Qualification } from '../qualification'
import { type EscalationSummary } from '../summary'
import { shadowIngestQualification } from '@/lib/ai/integration/shadowIngest'
import { shadowReasonAndDecide } from '@/lib/ai/integration/shadowCognition'
import { sendIreOutbound } from '../ireSend'
import type { QualifyCtx } from './types'

export function metaSource(metadata: unknown): string {
  try {
    const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    return (m as { source?: string } | null)?.source ?? ''
  } catch {
    return ''
  }
}

/** Send + persist an outbound AI message (tagged source=auto_response). */
export async function sendAndPersist(
  job: AutoResponseJob,
  ctx: QualifyCtx,
  send: typeof sendWhatsappText,
  text: string,
): Promise<{ ok: true; messageId: number; sequence: number } | { ok: false; reason: string; settled?: true }> {
  return sendIreOutbound(job, ctx, send, text)
}

export async function shadowQualificationIfLead(
  job: AutoResponseJob,
  convId: number,
  extracted: Qualification,
  turnCount: number,
): Promise<void> {
  if (!isPositiveLeadId(job.leadId)) return
  await shadowIngestQualification({
    agencyId: job.agencyId,
    leadId: job.leadId,
    conversationId: convId,
    extracted,
  })
  await shadowReasonAndDecide({
    agencyId: job.agencyId,
    leadId: job.leadId,
    conversationId: convId,
    turnCount,
  })
}

export async function persistEscalation(
  conversationId: number,
  agencyId: number,
  summary: EscalationSummary,
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
