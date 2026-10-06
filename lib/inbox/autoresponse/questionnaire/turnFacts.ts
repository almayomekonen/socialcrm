/**
 * Reading a turn's facts from the transcript: what the customer sent, and
 * whether a person has spoken. Extracted from processJob.ts so the turn itself
 * stays one readable sequence.
 */
import { db } from '@/config/db'
import { canUseAgentReliability } from '@/lib/flags/agentReliabilityFlags'
import { humanTookOverSinceEpoch, ownershipEpochSequence } from '../reliability/ownership'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from './definition'
import { tappedSelectionId } from './interactive'
import { classifyInboundKind } from './parseAnswer'
import type { InboundInput } from './transition'

type Row = Record<string, unknown>

export const TRANSCRIPT_COLUMNS = ['direction', 'type', 'text', 'payload', 'sequence', 'metadata', 'sentByUserId', 'status']

/**
 * The words of an inbound message. An image, video or document may carry a
 * caption ("18.11", "זה האולם ברחובות"): that is the customer typing, so it is
 * read as text rather than answered with "text only, please".
 */
function inboundText(row: Row): string {
  const text = String(row.text ?? '')
  if (text.trim()) return text
  const payload = (typeof row.payload === 'string' ? safeJson(row.payload) : row.payload) as { caption?: unknown } | null
  return typeof payload?.caption === 'string' ? payload.caption : ''
}

export function inboundInputs(transcript: readonly Row[], lastConsumed: number): InboundInput[] {
  return transcript
    .filter((m) => m.direction === 'inbound' && Number(m.sequence) > lastConsumed)
    .map((m) => {
      const text = inboundText(m)
      return {
        sequence: Number(m.sequence),
        kind: classifyInboundKind(String(m.type ?? 'unknown'), text),
        text,
        selectedId: tappedSelectionId(String(m.type ?? ''), m.payload) ?? undefined,
      }
    })
}

/**
 * Whether a person has spoken among these rows. Ownership is the AI agent's rule
 * (reliability/ownership.ts) for agencies in the reliability rollout: a person's
 * outbound after the last return-to-agent. Elsewhere, the original rule.
 */
export function humanSpokeIn(rows: readonly Row[], agencyId: number, qualification: unknown): boolean {
  return canUseAgentReliability(agencyId)
    ? humanTookOverSinceEpoch(rows as never, ownershipEpochSequence(qualification))
    : rows.some((m) => m.direction === 'outbound' && isHumanAuthored(m))
}

/**
 * A person spoke after the transcript this turn decided on: the owner answered
 * from the WhatsApp Business app while the turn was running. Their echo does
 * not set `human_active`, so the send guard cannot see it; this read can.
 * Checked immediately before every questionnaire send.
 */
export async function humanSpokeSince(
  agencyId: number,
  conversationId: number,
  afterSequence: number,
  qualification: unknown,
): Promise<boolean> {
  const rows = await db('inbox_messages')
    .where({ conversationId, agencyId, direction: 'outbound' })
    .andWhere('sequence', '>', afterSequence)
    .orderBy('sequence', 'asc')
    .select(TRANSCRIPT_COLUMNS)
  return rows.length > 0 && humanSpokeIn(rows, agencyId, qualification)
}

/**
 * An outbound nobody automated: a rep's own reply, or an echo from the business
 * phone. The rule for agencies outside the reliability rollout, kept verbatim.
 */
function isHumanAuthored(row: Row): boolean {
  const meta = row.metadata
  let source = ''
  try {
    const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta
    source = (parsed as { source?: string } | null)?.source ?? ''
  } catch {
    source = ''
  }
  if (source === 'auto_response') return false
  // An automation's template send carries no source and no user. That is a
  // machine talking, not a person taking over, and treating it as takeover
  // would stop the questionnaire the first time an unrelated automation fired.
  if (!source && row.sentByUserId == null) return false
  return true
}

/**
 * Sequence of the message that FIRST asked this session's open question, from
 * the step id each questionnaire send records. 0 when unknown (sent before the
 * id was recorded), which keeps the older rule: every pending message is a
 * candidate answer.
 */
export function firstAskedAt(transcript: readonly Row[], sessionId: number, stepId: string | null): number {
  if (!stepId) return 0
  for (const m of transcript) {
    if (m.direction !== 'outbound') continue
    const meta = (typeof m.metadata === 'string' ? safeJson(m.metadata) : m.metadata) as
      | { questionnaireStepId?: unknown; questionnaireTurnKey?: unknown }
      | null
    const turnKey = typeof meta?.questionnaireTurnKey === 'string' ? meta.questionnaireTurnKey : ''
    if (meta?.questionnaireStepId === stepId && turnKey.startsWith(`${sessionId}:`)) return Number(m.sequence)
  }
  return 0
}

export function sessionDefinition(value: unknown): QuestionnaireDefinition | null {
  const parsed = parseQuestionnaireDefinition(value ?? null)
  return parsed.ok ? parsed.definition : null
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
