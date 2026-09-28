import { db } from '@/config/db'

/**
 * System / webhook task-creation primitive — NO product-session authorization.
 *
 * For verified SERVER/SYSTEM flows only (e.g. inbound Facebook/WhatsApp lead →
 * "ליד חדש" task). It derives NO session (webhooks have no user cookie) and
 * inserts the task under the caller-provided `userId` (the lead's handler).
 * Tenant scope is already established upstream: the lead was created
 * agency-scoped by insertLeadSystem before this runs.
 *
 * NEVER import this from client/UI code — the user-facing task boundary is the
 * `createTask` server action, which is gated by requireProductAccess(). Keeping
 * the two apart means product authorization never blocks legitimate webhook
 * ingestion, and the user boundary can never be reached without product access.
 */
export async function createSystemTask({
  clientId,
  title,
  userId,
  dueDate,
}: {
  clientId: number
  title: string
  userId: number
  /**
   * `YYYY-MM-DD`. Optional and defaulted to today, so every existing caller —
   * the inbound-lead webhooks — behaves exactly as before. It exists because the
   * Agent's `create_task` action must be able to honour "a task for tomorrow",
   * and duplicating this insert to add one column would give the product two
   * definitions of what creating a task means.
   *
   * `tasks."dueDate"` is a DATE column: it stores no time of day, and nothing
   * here pretends otherwise.
   */
  dueDate?: string
}): Promise<number> {
  const res = await db('tasks')
    .insert({
      clientId,
      title,
      userId,
      dueDate: dueDate ?? new Date().toISOString().split('T')[0],
      tasks: [] as any,
      notes: [] as any,
      files: [],
    } as any)
    .returning('id')
  return res[0].id
}
