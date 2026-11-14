import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/config/db'
import { admitAgentRequest, voidUndeliveredRequest } from '@/db/credits/agentRequests'
import { withAiOperation } from '@/lib/ai/usage/context'
import { WA_ASSISTANT_LIMITS } from '@/lib/flags/waAssistantFlags'

/**
 * The owner's preview of the customer-facing agent runs the REAL agent's model
 * calls (gpt-5.6, the same prompts), and it is reachable by any admin with
 * product access — trials included — without the AI allowlist. It was the one
 * expensive AI path bounded only by the in-memory daily cap.
 *
 * Now every preview turn is:
 *   1. rate limited per user, durably (database counts, so restarts and parallel
 *      instances cannot reset it): at most PREVIEW_TURNS_PER_HOUR in a rolling hour;
 *   2. admitted like any other request — the monthly allowance, then purchased
 *      credits — under its own operation kind (`auto_response_preview`) so it is
 *      reported with the customer-facing agent and never mistaken for a real turn;
 *   3. released when it delivered no reply (refusal, validation failure, error).
 */

/** Same ceiling as one WhatsApp assistant sender (WA_ASSISTANT_LIMITS.perSenderPerHour). */
export const PREVIEW_TURNS_PER_HOUR = WA_ASSISTANT_LIMITS.perSenderPerHour
export const PREVIEW_OPERATION_KIND = 'auto_response_preview'

export type PreviewRefusal = 'rate_limited' | 'credits_exhausted' | 'ai_unavailable'

/**
 * Preview turns this user started in the last hour. Counted from both durable
 * records — the request rows (written when credits metering is on) and the usage
 * ledger (written when AI_USAGE_LEDGER is on) — so the limit holds with either.
 */
export async function previewTurnsLastHour(agencyId: number, userId: number, nowMs = Date.now()): Promise<number> {
  const since = new Date(nowMs - 60 * 60_000)
  const [requests, ledger] = await Promise.all([
    db('agent_requests').where({ agencyId, userId, operationKind: PREVIEW_OPERATION_KIND }).where('createdAt', '>', since).count({ n: '*' }).first(),
    db('ai_usage_events').where({ agencyId, userId, operationKind: PREVIEW_OPERATION_KIND }).where('createdAt', '>', since).countDistinct({ n: 'operationId' }).first(),
  ])
  return Math.max(Number(requests?.n ?? 0), Number(ledger?.n ?? 0))
}

const isUndelivered = (r: unknown) => typeof r === 'object' && r !== null && 'ok' in r && (r as { ok: unknown }).ok === false

export async function runPreviewRequest<T>(
  user: { id: number; agencyId: number },
  refused: (why: PreviewRefusal) => T,
  run: () => Promise<T>,
): Promise<T> {
  if ((await previewTurnsLastHour(user.agencyId, user.id)) >= PREVIEW_TURNS_PER_HOUR) return refused('rate_limited')
  const operation = { kind: PREVIEW_OPERATION_KIND, id: randomUUID() }
  const access = await admitAgentRequest({ agencyId: user.agencyId, userId: user.id, source: 'web', operation, nowMs: Date.now() })
  if ('reason' in access) return refused(access.reason === 'credits_required' ? 'credits_exhausted' : 'ai_unavailable')
  try {
    const result = await withAiOperation({ ...operation, agencyId: user.agencyId, userId: user.id }, run)
    if (isUndelivered(result)) await voidUndeliveredRequest(user.agencyId, operation)
    return result
  } catch (err) {
    await voidUndeliveredRequest(user.agencyId, operation)
    throw err
  }
}
