import { db } from '@/config/db'

/**
 * Read-only queries for the Phase 1.5 inspector at /settings/ai-inspector.
 *
 * Scope rules:
 *   - All queries are tenant-scoped by `agencyId`. The inspector never reads
 *     across agencies even though it runs under ADMIN role.
 *   - Provider/model fields appear ONLY in `ai_runs` queries — never joined
 *     into `ai_messages` reads. This is a structural enforcement of the
 *     ai-safety-boundaries doctrine.
 *   - Result shapes here are inspector-specific. They are NOT the future
 *     timeline UI types; the timeline (Phase 2) will read through
 *     `db/aiMessages.ts:listConversationMessages` instead.
 */

export type InspectorWindow = '24h' | '7d' | '30d' | 'all'

function windowSince(window: InspectorWindow): Date | null {
  if (window === 'all') return null
  const ms = window === '24h' ? 24 * 60 * 60_000 : window === '7d' ? 7 * 24 * 60 * 60_000 : 30 * 24 * 60 * 60_000
  return new Date(Date.now() - ms)
}

export type ConversationListRow = {
  id: number
  leadId: number
  createdByUserId: number
  state: string
  messageCount: number
  lastMessageAt: string | null
  createdAt: string
}

export async function listRecentConversations(opts: {
  agencyId: number
  leadId?: number | null
  limit?: number
}): Promise<ConversationListRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100)
  let q = db('ai_conversations').where({ agencyId: opts.agencyId })
  if (typeof opts.leadId === 'number' && opts.leadId > 0) q = q.andWhere({ leadId: opts.leadId })
  const rows = await q
    .orderBy('lastMessageAt', 'desc', 'last')
    .orderBy('id', 'desc')
    .limit(limit)
    .select('id', 'leadId', 'createdByUserId', 'state', 'messageCount', 'lastMessageAt', 'createdAt')
  return rows.map((r) => ({
    id: Number(r.id),
    leadId: Number(r.leadId),
    createdByUserId: Number(r.createdByUserId),
    state: String(r.state),
    messageCount: Number(r.messageCount),
    lastMessageAt: r.lastMessageAt instanceof Date ? r.lastMessageAt.toISOString() : r.lastMessageAt ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }))
}

export type MessageListRow = {
  id: number
  conversationId: number
  parentMessageId: number | null
  role: string
  status: string
  actionId: string | null
  taskKind: string | null
  mode: string | null
  sequence: number
  textPreview: string
  errorReason: string | null
  hasStructuredPayload: boolean
  createdAt: string
}

export async function listRecentMessages(opts: {
  agencyId: number
  leadId?: number | null
  conversationId?: number | null
  status?: string | null
  window?: InspectorWindow
  limit?: number
}): Promise<MessageListRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const since = windowSince(opts.window ?? '7d')

  let q = db('ai_messages as m').where({ 'm.agencyId': opts.agencyId })
  if (typeof opts.conversationId === 'number' && opts.conversationId > 0) {
    q = q.andWhere({ 'm.conversationId': opts.conversationId })
  } else if (typeof opts.leadId === 'number' && opts.leadId > 0) {
    // Filter by lead via the conversation join.
    q = q
      .join('ai_conversations as c', 'c.id', 'm.conversationId')
      .andWhere({ 'c.leadId': opts.leadId })
  }
  if (opts.status) q = q.andWhere({ 'm.status': opts.status })
  if (since) q = q.andWhere('m.createdAt', '>=', since)

  const rows = await q
    .orderBy('m.id', 'desc')
    .limit(limit)
    .select(
      'm.id',
      'm.conversationId',
      'm.parentMessageId',
      'm.role',
      'm.status',
      'm.actionId',
      'm.taskKind',
      'm.mode',
      'm.sequence',
      'm.text',
      'm.errorReason',
      db.raw('("m"."structuredPayload" IS NOT NULL) AS has_payload'),
      'm.createdAt',
    )

  return rows.map((r) => ({
    id: Number(r.id),
    conversationId: Number(r.conversationId),
    parentMessageId: r.parentMessageId == null ? null : Number(r.parentMessageId),
    role: String(r.role),
    status: String(r.status),
    actionId: (r.actionId as string | null) ?? null,
    taskKind: (r.taskKind as string | null) ?? null,
    mode: (r.mode as string | null) ?? null,
    sequence: Number(r.sequence),
    textPreview: typeof r.text === 'string' ? r.text.slice(0, 160) : '',
    errorReason: (r.errorReason as string | null) ?? null,
    hasStructuredPayload: Boolean(r.has_payload),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }))
}

export type RunListRow = {
  id: number
  messageId: number | null
  taskKind: string
  role: string
  mode: string | null
  provider: string | null
  model: string | null
  chainIndex: number | null
  success: boolean
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number | null
  errorCode: string | null
  startedAt: string
}

export async function listRecentRuns(opts: {
  agencyId: number
  leadId?: number | null
  success?: boolean | null
  window?: InspectorWindow
  limit?: number
}): Promise<RunListRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const since = windowSince(opts.window ?? '7d')

  let q = db('ai_runs').where({ agencyId: opts.agencyId })
  if (typeof opts.leadId === 'number' && opts.leadId > 0) q = q.andWhere({ leadId: opts.leadId })
  if (typeof opts.success === 'boolean') q = q.andWhere({ success: opts.success })
  if (since) q = q.andWhere('startedAt', '>=', since)

  const rows = await q
    .orderBy('id', 'desc')
    .limit(limit)
    .select(
      'id',
      'messageId',
      'taskKind',
      'role',
      'mode',
      'provider',
      'model',
      'chainIndex',
      'success',
      'inputTokens',
      'outputTokens',
      'costUsd',
      'latencyMs',
      'errorCode',
      'startedAt',
    )

  return rows.map((r) => ({
    id: Number(r.id),
    messageId: r.messageId == null ? null : Number(r.messageId),
    taskKind: String(r.taskKind),
    role: String(r.role),
    mode: (r.mode as string | null) ?? null,
    provider: (r.provider as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    chainIndex: r.chainIndex == null ? null : Number(r.chainIndex),
    success: Boolean(r.success),
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
    costUsd: Number(r.costUsd),
    latencyMs: r.latencyMs == null ? null : Number(r.latencyMs),
    errorCode: (r.errorCode as string | null) ?? null,
    startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt),
  }))
}

export type InspectorTotals = {
  conversations: number
  messages: number
  runs: number
  runsSuccess: number
  runsFail: number
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
}

export async function getInspectorTotals(opts: {
  agencyId: number
  window?: InspectorWindow
}): Promise<InspectorTotals> {
  const since = windowSince(opts.window ?? '7d')

  const [convs, msgs, runAgg] = await Promise.all([
    db('ai_conversations').where({ agencyId: opts.agencyId }).count<{ count: string }>('* as count').first(),
    (() => {
      let q = db('ai_messages').where({ agencyId: opts.agencyId })
      if (since) q = q.andWhere('createdAt', '>=', since)
      return q.count<{ count: string }>('* as count').first()
    })(),
    (() => {
      let q = db('ai_runs').where({ agencyId: opts.agencyId })
      if (since) q = q.andWhere('startedAt', '>=', since)
      return q
        .select<{
          total: string
          success: string
          fail: string
          cost: string
          input: string
          output: string
        }>(
          db.raw(`COUNT(*) AS total`),
          db.raw(`COUNT(*) FILTER (WHERE success = true) AS success`),
          db.raw(`COUNT(*) FILTER (WHERE success = false) AS fail`),
          db.raw(`COALESCE(SUM("costUsd"), 0) AS cost`),
          db.raw(`COALESCE(SUM("inputTokens"), 0) AS input`),
          db.raw(`COALESCE(SUM("outputTokens"), 0) AS output`),
        )
        .first()
    })(),
  ])

  return {
    conversations: Number(convs?.count ?? 0),
    messages: Number(msgs?.count ?? 0),
    runs: Number(runAgg?.total ?? 0),
    runsSuccess: Number(runAgg?.success ?? 0),
    runsFail: Number(runAgg?.fail ?? 0),
    totalCostUsd: Number(runAgg?.cost ?? 0),
    totalInputTokens: Number(runAgg?.input ?? 0),
    totalOutputTokens: Number(runAgg?.output ?? 0),
  }
}

export type LatencyBucket = {
  taskKind: string
  count: number
  p50Ms: number | null
  p95Ms: number | null
  avgMs: number | null
}

export async function getLatencyByTaskKind(opts: {
  agencyId: number
  window?: InspectorWindow
}): Promise<LatencyBucket[]> {
  const since = windowSince(opts.window ?? '7d')
  let q = db('ai_runs').where({ agencyId: opts.agencyId, success: true })
  if (since) q = q.andWhere('startedAt', '>=', since)

  const rows = await q
    .groupBy('taskKind')
    .select<
      { taskKind: string; count: string; p50: string | null; p95: string | null; avg: string | null }[]
    >(
      'taskKind',
      db.raw(`COUNT(*) AS count`),
      db.raw(`percentile_disc(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS p50`),
      db.raw(`percentile_disc(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95`),
      db.raw(`AVG("latencyMs")::int AS avg`),
    )

  return rows.map((r) => ({
    taskKind: r.taskKind,
    count: Number(r.count),
    p50Ms: r.p50 == null ? null : Number(r.p50),
    p95Ms: r.p95 == null ? null : Number(r.p95),
    avgMs: r.avg == null ? null : Number(r.avg),
  }))
}

export type ProviderUsage = {
  provider: string
  model: string
  count: number
  successCount: number
  costUsd: number
}

export async function getProviderUsage(opts: {
  agencyId: number
  window?: InspectorWindow
}): Promise<ProviderUsage[]> {
  const since = windowSince(opts.window ?? '7d')
  let q = db('ai_runs').where({ agencyId: opts.agencyId }).whereNotNull('provider').whereNotNull('model')
  if (since) q = q.andWhere('startedAt', '>=', since)

  const rows = await q
    .groupBy('provider', 'model')
    .select<
      { provider: string; model: string; count: string; success: string; cost: string }[]
    >(
      'provider',
      'model',
      db.raw(`COUNT(*) AS count`),
      db.raw(`COUNT(*) FILTER (WHERE success = true) AS success`),
      db.raw(`COALESCE(SUM("costUsd"), 0) AS cost`),
    )
    .orderBy('count', 'desc')

  return rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    count: Number(r.count),
    successCount: Number(r.success),
    costUsd: Number(r.cost),
  }))
}

/**
 * Doctrine probe. Returns the list of columns Postgres reports for
 * ai_messages. The inspector renders this and explicitly flags whether
 * `provider` or `model` appears — which would be a regression of the
 * abstraction boundary. Phase 1 expectation: neither column exists.
 */
export async function getMessagesColumnList(): Promise<string[]> {
  const rows = await db.raw<{ rows: { column_name: string }[] }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'ai_messages'
    ORDER BY ordinal_position
  `)
  return (rows.rows ?? []).map((r) => r.column_name)
}
