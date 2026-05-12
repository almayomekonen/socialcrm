import { db } from '@/config/db'

/**
 * Append-only timeline layer. Two doctrine invariants:
 *
 *   1. Messages NEVER store provider names or model IDs. Those live only on
 *      `ai_runs`. UI reads messages, so this is structural enforcement of the
 *      provider-abstraction boundary.
 *   2. Append-only. Retries create a sibling message with `parentMessageId`
 *      pointing at the failed one. Existing messages are never mutated for
 *      content — only `status`/`completedAt`/`text` may update during streaming
 *      (Phase 3+), and never after `status='complete'`.
 *
 * Sequence assignment is per-conversation, monotonic. Computed under a row
 * lock on the parent conversation so the (conversationId, sequence) unique
 * index never trips under concurrent appends.
 */

export type MessageRole = 'user' | 'assistant' | 'system'
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'failed' | 'aborted'

export type AiMessageRow = {
  id: number
  conversationId: number
  agencyId: number
  parentMessageId: number | null
  role: MessageRole
  mode: string | null
  taskKind: string | null
  actionId: string | null
  status: MessageStatus
  text: string
  structuredPayload: unknown | null
  attachments: unknown[]
  lenses: unknown[]
  errorReason: string | null
  metadata: Record<string, unknown>
  createdAt: string
  completedAt: string | null
  sequence: number
}

export type AppendMessageInput = {
  conversationId: number
  agencyId: number
  role: MessageRole
  parentMessageId?: number | null
  mode?: string | null
  taskKind?: string | null
  actionId?: string | null
  status?: MessageStatus
  text?: string
  structuredPayload?: unknown
  attachments?: unknown[]
  lenses?: unknown[]
  errorReason?: string | null
  metadata?: Record<string, unknown>
}

export async function appendMessage(input: AppendMessageInput): Promise<number> {
  return db.transaction(async (trx) => {
    const conv = await trx('ai_conversations')
      .where({ id: input.conversationId })
      .forUpdate()
      .first('id', 'agencyId')
    if (!conv) throw new Error('ai_messages.append.conversation_not_found')
    if (Number(conv.agencyId) !== input.agencyId) {
      throw new Error('ai_messages.append.agency_mismatch')
    }

    const maxRow = await trx('ai_messages')
      .where({ conversationId: input.conversationId })
      .max<{ max: string | number | null }>('sequence as max')
      .first()
    const sequence = (Number(maxRow?.max) || 0) + 1

    const status: MessageStatus = input.status ?? 'complete'
    const now = new Date()
    const completedAt =
      status === 'complete' || status === 'failed' || status === 'aborted' ? now : null

    const [row] = await trx('ai_messages')
      .insert({
        conversationId: input.conversationId,
        agencyId: input.agencyId,
        parentMessageId: input.parentMessageId ?? null,
        role: input.role,
        mode: input.mode ?? null,
        taskKind: input.taskKind ?? null,
        actionId: input.actionId ?? null,
        status,
        text: input.text ?? '',
        structuredPayload:
          input.structuredPayload === undefined || input.structuredPayload === null
            ? null
            : JSON.stringify(input.structuredPayload),
        attachments: JSON.stringify(input.attachments ?? []),
        lenses: JSON.stringify(input.lenses ?? []),
        errorReason: input.errorReason ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
        completedAt,
        sequence,
      })
      .returning('id')

    await trx('ai_conversations')
      .where({ id: input.conversationId })
      .update({
        lastMessageAt: now,
        updatedAt: now,
        messageCount: trx.raw('"messageCount" + 1'),
      })

    return Number(row.id)
  })
}

/**
 * Phase 2+ timeline read. Cursor by `sequence` descending; client passes the
 * smallest `sequence` it currently has as `before` to load older history.
 * Exposed in Phase 1 so the persistence layer is testable in isolation.
 */
export async function listConversationMessages(opts: {
  conversationId: number
  agencyId: number
  before?: number
  limit?: number
}): Promise<AiMessageRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100)
  let q = db('ai_messages')
    .where({ conversationId: opts.conversationId, agencyId: opts.agencyId })
    .orderBy('sequence', 'desc')
    .limit(limit)
  if (typeof opts.before === 'number' && Number.isFinite(opts.before)) {
    q = q.andWhere('sequence', '<', opts.before)
  }
  const rows = await q.select('*')
  return rows.map(normalizeMessageRow)
}

function normalizeMessageRow(raw: Record<string, unknown>): AiMessageRow {
  return {
    id: Number(raw.id),
    conversationId: Number(raw.conversationId),
    agencyId: Number(raw.agencyId),
    parentMessageId: raw.parentMessageId == null ? null : Number(raw.parentMessageId),
    role: raw.role as MessageRole,
    mode: (raw.mode as string | null) ?? null,
    taskKind: (raw.taskKind as string | null) ?? null,
    actionId: (raw.actionId as string | null) ?? null,
    status: raw.status as MessageStatus,
    text: (raw.text as string) ?? '',
    structuredPayload: raw.structuredPayload ?? null,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    lenses: Array.isArray(raw.lenses) ? raw.lenses : [],
    errorReason: (raw.errorReason as string | null) ?? null,
    metadata:
      raw.metadata && typeof raw.metadata === 'object' ? (raw.metadata as Record<string, unknown>) : {},
    createdAt: raw.createdAt instanceof Date ? raw.createdAt.toISOString() : String(raw.createdAt),
    completedAt:
      raw.completedAt instanceof Date
        ? raw.completedAt.toISOString()
        : raw.completedAt
          ? String(raw.completedAt)
          : null,
    sequence: Number(raw.sequence),
  }
}
