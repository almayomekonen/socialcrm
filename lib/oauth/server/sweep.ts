import 'server-only'
import { db } from '@/config/db'

/**
 * Daily retention sweep for OAuth + MCP rows. Every cutoff is computed by the
 * DATABASE (`NOW() - interval`), the same clock the OAuth store uses for
 * expiry, never the app server's.
 *
 * Retention (spec "Retention / accumulation", tightened where noted):
 *   - authorization codes: older than 1 day AND expired. Codes live 120 s, so
 *     every consumed or expired code is long past use; a still-valid code can
 *     never match (expires_at must be in the past).
 *   - refresh tokens: kept while they can still be presented OR still serve
 *     replay detection. rotateRefreshToken checks `used_at` BEFORE expiry, so a
 *     replayed used token revokes its family and grant even after it expired;
 *     that evidence is kept for 30 days after use.
 *       revoked                     → revoked_at < NOW() - 30 days
 *       used (not revoked)          → used_at < NOW() - 30 days AND expires_at < NOW() - 1 day
 *       never used, not revoked     → expires_at < NOW() - 1 day
 *     An active token (not used, not revoked, not expired) never matches.
 *   - MCP audit events: occurred_at < NOW() - 180 days.
 *   - grants: revoked_at < NOW() - 180 days AND no remaining code, refresh
 *     token or audit row. Children reference oauth_grants ON DELETE CASCADE;
 *     deleting only childless grants makes that cascade a no-op, so a grant
 *     deletion can never remove audit history or replay evidence early.
 *     Active grants never match.
 *
 * Order: codes → refresh tokens → audit → grants (children first).
 *
 * Bounded: each table is deleted in batches of SWEEP_BATCH rows (by id, oldest
 * first), looping until a batch comes back short, capped at SWEEP_MAX_BATCHES
 * per table per run; the remainder is picked up by the next daily run.
 * Idempotent: a second run immediately after finds nothing to delete.
 */

export const SWEEP_BATCH = 5_000
export const SWEEP_MAX_BATCHES = 100

export const RETENTION = {
  codesDays: 1,
  refreshRevokedDays: 30,
  refreshUsedDays: 30,
  refreshExpiredGraceDays: 1,
  auditDays: 180,
  grantsRevokedDays: 180,
} as const

export type SweepCounts = { codes: number; refreshTokens: number; audit: number; grants: number }

const ago = (days: number) => db.raw('NOW() - make_interval(days => ?)', [days])

/** Delete matching rows in id-ordered batches; returns how many were deleted. */
async function deleteInBatches(table: string, where: (q: ReturnType<typeof db>) => void): Promise<number> {
  let total = 0
  for (let i = 0; i < SWEEP_MAX_BATCHES; i++) {
    const ids = db(table).select('id').orderBy('id').limit(SWEEP_BATCH)
    where(ids)
    const n = await db(table).whereIn('id', ids).del()
    total += n
    if (n < SWEEP_BATCH) break
  }
  return total
}

export async function sweepOAuthState(): Promise<SweepCounts> {
  const codes = await deleteInBatches('oauth_authorization_codes', (q) =>
    q.where('created_at', '<', ago(RETENTION.codesDays)).where('expires_at', '<', db.fn.now()),
  )

  const refreshTokens = await deleteInBatches('oauth_refresh_tokens', (q) =>
    q.where((w) =>
      w
        .where((r) => r.whereNotNull('revoked_at').where('revoked_at', '<', ago(RETENTION.refreshRevokedDays)))
        .orWhere((u) =>
          u
            .whereNull('revoked_at')
            .whereNotNull('used_at')
            .where('used_at', '<', ago(RETENTION.refreshUsedDays))
            .where('expires_at', '<', ago(RETENTION.refreshExpiredGraceDays)),
        )
        .orWhere((e) =>
          e.whereNull('revoked_at').whereNull('used_at').where('expires_at', '<', ago(RETENTION.refreshExpiredGraceDays)),
        ),
    ),
  )

  const audit = await deleteInBatches('mcp_audit_events', (q) => q.where('occurred_at', '<', ago(RETENTION.auditDays)))

  const grants = await deleteInBatches('oauth_grants', (q) =>
    q
      .whereNotNull('revoked_at')
      .where('revoked_at', '<', ago(RETENTION.grantsRevokedDays))
      .whereNotExists((s) =>
        s.select(db.raw('1')).from('oauth_authorization_codes as c').whereRaw('c.grant_id = oauth_grants.id'),
      )
      .whereNotExists((s) => s.select(db.raw('1')).from('oauth_refresh_tokens as r').whereRaw('r.grant_id = oauth_grants.id'))
      .whereNotExists((s) => s.select(db.raw('1')).from('mcp_audit_events as a').whereRaw('a.grant_id = oauth_grants.id')),
  )

  return { codes, refreshTokens, audit, grants }
}
