/** Shared fixtures for the Reminder Engine Phase 3 database tests. */
import { db } from '@/config/db'
import { seedAgency, seedUser } from '../mcp/fixtures'

let seq = 0

/** An agency, an ADMIN owner and an active, verified owner_whatsapp_recipients row. */
export async function seedOwner(name = 'rem'): Promise<{ agencyId: number; userId: number; recipientId: number }> {
  const agencyId = await seedAgency(`${name}-${++seq}`)
  const userId = await seedUser(agencyId, 'ADMIN', `Owner${seq}`)
  const [r] = await db('owner_whatsapp_recipients')
    .insert({
      agencyId,
      userId,
      phoneE164: `+97250${String(1_000_000 + seq).slice(-7)}`,
      status: 'active',
      consentAt: db.fn.now(),
      consentTextVersion: 'v4',
      consentSource: 'settings',
      verifiedAt: db.fn.now(),
    })
    .returning('id')
  return { agencyId, userId, recipientId: Number(r.id) }
}

export type Owner = Awaited<ReturnType<typeof seedOwner>>

const HOUR = 3_600_000

/** A `proposed` draft, the row T0 will create. Every column can be overridden. */
export async function insertDraft(o: Owner, over: Record<string, unknown> = {}): Promise<number> {
  const text = (over.text as string | undefined) ?? 'להתקשר לאבי'
  const [row] = await db('owner_personal_reminders')
    .insert({
      agencyId: o.agencyId,
      userId: o.userId,
      recipientId: o.recipientId,
      text,
      textLength: [...text].length,
      remindAt: new Date(Date.now() + HOUR),
      anchorMessageTs: Math.floor(Date.now() / 1000),
      sourceWamid: `wamid.rem.${++seq}`,
      status: 'proposed',
      draftExpiresAt: new Date(Date.now() + 15 * 60_000),
      ...over,
    })
    .returning('id')
  return Number(row.id)
}

/** A pending approval row as a creation path would write it. */
export async function insertApproval(o: Owner, actionId: string, over: Record<string, unknown> = {}): Promise<string> {
  const token = `tok${++seq}`.padEnd(32, '0')
  await db('wa_assistant_approvals').insert({
    token,
    recipientId: o.recipientId,
    agencyId: o.agencyId,
    userId: o.userId,
    jobId: 0,
    actionId,
    argsHash: 'h',
    expiresAt: new Date(Date.now() + 15 * 60_000),
    ...over,
  })
  return token
}

/** The Postgres error code of a rejected promise (23505 unique, 23514 check, 23001 restrict). */
export async function pgCode(p: Promise<unknown>): Promise<string | null> {
  try {
    await p
    return null
  } catch (err) {
    return (err as { code?: string }).code ?? 'no-code'
  }
}

/**
 * Resolve once `n` backends in this database are blocked on a row lock, so a race
 * can be ordered deterministically (no sleeps decide the interleaving).
 */
export async function untilLockWaiters(n: number, timeoutMs = 5_000): Promise<void> {
  const start = Date.now()
  for (;;) {
    const { rows } = await db.raw(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    )
    if (rows[0].n >= n) return
    if (Date.now() - start > timeoutMs) throw new Error(`expected ${n} lock waiter(s), saw ${rows[0].n}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}
