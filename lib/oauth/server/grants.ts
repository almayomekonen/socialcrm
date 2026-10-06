import 'server-only'
import type { Knex } from 'knex'
import { db } from '@/config/db'

/**
 * oauth_grants — "this user authorized this client for this resource".
 *
 * At most one ACTIVE row per (user, client_id, resource), enforced by the
 * partial unique index from the migration. Re-consent locks and updates that row
 * (scopes are unioned); only after a revocation does a new row appear. Revocation
 * always records a reason and never overwrites the first one.
 */

export type RevokeReason =
  | 'user_disconnect'
  | 'code_replay'
  | 'refresh_reuse'
  | 'session_revoked'
  | 'user_suspended'
  | 'user_missing'
  | 'agency_changed'
  | 'not_allowlisted'
  | 'client_revoked'
  | 'admin'

export type Grant = {
  id: number
  userId: number
  agencyId: number
  clientId: string
  clientName: string
  resource: string
  scopes: string[]
  sessionVersion: number
  createdAt: Date
  lastUsedAt: Date | null
}

export type GrantInput = Omit<Grant, 'id' | 'createdAt' | 'lastUsedAt'>

type Row = {
  id: string | number
  user_id: number
  agency_id: number
  client_id: string
  client_name: string
  resource: string
  scopes: string[]
  session_version: number
  created_at: Date
  last_used_at: Date | null
}

const COLS = [
  'id',
  'user_id',
  'agency_id',
  'client_id',
  'client_name',
  'resource',
  'scopes',
  'session_version',
  'created_at',
  'last_used_at',
] as const

const toGrant = (r: Row): Grant => ({
  id: Number(r.id),
  userId: r.user_id,
  agencyId: r.agency_id,
  clientId: r.client_id,
  clientName: r.client_name,
  resource: r.resource,
  scopes: r.scopes,
  sessionVersion: r.session_version,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
})

type Conn = Knex | Knex.Transaction
const isTrx = (c: Conn): c is Knex.Transaction => (c as Knex.Transaction).isTransaction === true

/** Run `fn` in the caller's transaction, or in a new one. */
function inTransaction<T>(conn: Conn, fn: (t: Knex.Transaction) => Promise<T>): Promise<T> {
  return isTrx(conn) ? fn(conn) : conn.transaction(fn)
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505'

async function mergeInto(t: Knex.Transaction, existing: Row, input: GrantInput): Promise<Grant> {
  const scopes = Array.from(new Set([...existing.scopes, ...input.scopes])).sort()
  const [row] = await t('oauth_grants')
    .where({ id: existing.id })
    .update({
      scopes,
      client_name: input.clientName,
      agency_id: input.agencyId,
      session_version: input.sessionVersion,
    })
    .returning([...COLS])
  return toGrant(row as Row)
}

const activeFor = (t: Knex.Transaction, input: GrantInput) =>
  t('oauth_grants').where({ user_id: input.userId, client_id: input.clientId, resource: input.resource }).whereNull('revoked_at')

/**
 * Create the active grant, or lock and merge into the existing one.
 *
 * Race: two concurrent first-time consents both find no row to lock and both
 * insert; the partial unique index makes the second insert fail. That insert
 * runs in a SAVEPOINT, so the failure does not poison the caller's transaction;
 * the loser then locks the winner's row and merges into it.
 */
export async function upsertActiveGrant(input: GrantInput, conn: Conn = db): Promise<Grant> {
  return inTransaction(conn, async (t) => {
    const existing = (await activeFor(t, input)
      .forUpdate()
      .first(...COLS)) as Row | undefined
    if (existing) return mergeInto(t, existing, input)

    try {
      const [row] = await t.transaction((sp) =>
        sp('oauth_grants')
          .insert({
            user_id: input.userId,
            agency_id: input.agencyId,
            client_id: input.clientId,
            client_name: input.clientName,
            resource: input.resource,
            scopes: Array.from(new Set(input.scopes)).sort(),
            session_version: input.sessionVersion,
          })
          .returning([...COLS]),
      )
      return toGrant(row as Row)
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
      const winner = (await activeFor(t, input)
        .forUpdate()
        .first(...COLS)) as Row | undefined
      if (!winner) throw e
      return mergeInto(t, winner, input)
    }
  })
}

/** The grant if it exists AND is not revoked; otherwise null. */
export async function getActiveGrant(id: number, conn: Conn = db): Promise<Grant | null> {
  const row = (await conn('oauth_grants')
    .where({ id })
    .whereNull('revoked_at')
    .first(...COLS)) as Row | undefined
  return row ? toGrant(row) : null
}

/**
 * Revoke a grant and every refresh token under it, atomically. Idempotent: an
 * already-revoked grant or token keeps its original reason and timestamp.
 */
export async function revokeGrant(id: number, reason: RevokeReason, conn: Conn = db): Promise<void> {
  await inTransaction(conn, async (t) => {
    await t('oauth_grants').where({ id }).whereNull('revoked_at').update({ revoked_at: t.fn.now(), revoked_reason: reason })
    await t('oauth_refresh_tokens')
      .where({ grant_id: id })
      .whereNull('revoked_at')
      .update({ revoked_at: t.fn.now(), revoked_reason: reason })
  })
}

/**
 * Revoke a grant only if it belongs to this user (and agency) — the Settings
 * disconnect path. Ownership is checked and the revocation applied in ONE
 * transaction with the row locked, so a grant id from the client can never
 * revoke someone else's grant. Same effect as revokeGrant: the grant and all
 * of its refresh tokens are revoked, and an existing revocation (reason and
 * time) is never overwritten. Idempotent.
 */
export async function revokeGrantForUser(
  userId: number,
  agencyId: number,
  grantId: number,
  reason: RevokeReason,
): Promise<'revoked' | 'already_revoked' | 'not_found'> {
  return db.transaction(async (t) => {
    const row = (await t('oauth_grants')
      .where({ id: grantId, user_id: userId, agency_id: agencyId })
      .forUpdate()
      .first('id', 'revoked_at')) as { id: number; revoked_at: Date | null } | undefined
    if (!row) return 'not_found'
    const wasActive = row.revoked_at === null
    await revokeGrant(grantId, reason, t)
    return wasActive ? 'revoked' : 'already_revoked'
  })
}

export async function listActiveGrantsForUser(userId: number): Promise<Grant[]> {
  const rows = (await db('oauth_grants')
    .where({ user_id: userId })
    .whereNull('revoked_at')
    .orderBy('created_at', 'desc')
    .select(...COLS)) as Row[]
  return rows.map(toGrant)
}

/** At most one write per grant per 5 minutes; a single conditional UPDATE. */
export async function touchGrant(id: number): Promise<void> {
  await db('oauth_grants')
    .where({ id })
    .whereNull('revoked_at')
    .where((q) => q.whereNull('last_used_at').orWhere('last_used_at', '<', db.raw("NOW() - interval '5 minutes'")))
    .update({ last_used_at: db.fn.now() })
}
