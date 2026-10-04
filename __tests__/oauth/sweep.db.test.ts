import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { db } from '@/config/db'
import { sweepOAuthState, SWEEP_BATCH } from '@/lib/oauth/server/sweep'
import { GET, POST } from '@/app/api/cron/oauth-sweep/route'

/**
 * Task 16 retention sweep. Every timestamp is seeded relative to the DATABASE
 * clock (`NOW() ± interval`), the same clock the sweep uses, with margins of
 * minutes or more so boundaries are deterministic.
 */

const at = (sql: string) => db.raw(`NOW() + interval '${sql}'`)
const CLIENT = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
const BOTH = ['crm.leads.read', 'crm.conversations.read']

async function grant(revoked: string | null = null): Promise<number> {
  const [g] = await db('oauth_grants')
    .insert({
      user_id: 1,
      agency_id: 1,
      client_id: `${CLIENT}#${randomUUID()}`, // unique per row; the one-active index ignores revoked rows
      client_name: 'Claude',
      resource: 'https://crm.test/api/mcp',
      scopes: BOTH,
      session_version: 0,
      revoked_at: revoked ? at(revoked) : null,
      revoked_reason: revoked ? 'user_disconnect' : null,
    })
    .returning('id')
  return Number(g.id)
}

async function code(grantId: number, created: string, expires: string, consumed: string | null = null): Promise<number> {
  const [c] = await db('oauth_authorization_codes')
    .insert({
      code_hash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      grant_id: grantId,
      request_jti: randomUUID(),
      client_id: CLIENT,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: 'x'.repeat(43),
      scopes: BOTH,
      resource: 'https://crm.test/api/mcp',
      created_at: at(created),
      expires_at: at(expires),
      consumed_at: consumed ? at(consumed) : null,
    })
    .returning('id')
  return Number(c.id)
}

async function refresh(grantId: number, o: { expires: string; used?: string; revoked?: string }): Promise<number> {
  const [r] = await db('oauth_refresh_tokens')
    .insert({
      grant_id: grantId,
      user_id: 1,
      family_id: randomUUID(),
      token_hash: randomUUID().replace(/-/g, '').padEnd(64, '1'),
      scopes: BOTH,
      expires_at: at(o.expires),
      used_at: o.used ? at(o.used) : null,
      revoked_at: o.revoked ? at(o.revoked) : null,
      revoked_reason: o.revoked ? 'user_disconnect' : null,
    })
    .returning('id')
  return Number(r.id)
}

async function audit(grantId: number, occurred: string): Promise<number> {
  const [a] = await db('mcp_audit_events')
    .insert({
      request_id: randomUUID(),
      occurred_at: at(occurred),
      agency_id: 1,
      user_id: 1,
      grant_id: grantId,
      client_id: CLIENT,
      source: 'claude',
      tool: 'get_lead',
      kind: 'read',
      params: '{}',
      outcome: 'ok',
    })
    .returning('id')
  return Number(a.id)
}

const exists = async (table: string, id: number) => !!(await db(table).where({ id }).first('id'))
const snapshot = async () => ({
  codes: await db('oauth_authorization_codes').orderBy('id').pluck('id'),
  refresh: await db('oauth_refresh_tokens').orderBy('id').pluck('id'),
  audit: await db('mcp_audit_events').orderBy('id').pluck('id'),
  grants: await db('oauth_grants').orderBy('id').pluck('id'),
})

beforeEach(async () => {
  vi.unstubAllEnvs()
  await db.raw(
    'TRUNCATE mcp_audit_events, oauth_refresh_tokens, oauth_authorization_codes, oauth_grants RESTART IDENTITY CASCADE',
  )
})
afterAll(async () => {
  await db.destroy()
})

describe('authorization codes', () => {
  it('deletes old expired and old consumed codes; keeps valid and recent ones', async () => {
    const g = await grant()
    const valid = await code(g, '0 seconds', '2 minutes')
    const expiredOld = await code(g, '-2 days', '-2 days 2 minutes')
    const consumedOld = await code(g, '-2 days', '-2 days 2 minutes', '-2 days 1 minute')
    const recentExpired = await code(g, '-2 hours', '-2 hours 2 minutes')
    const recentConsumed = await code(g, '-1 hour', '-1 hour 2 minutes', '-1 hour 1 minute')
    // Never delete a still-valid code, whatever its age.
    const oldButValid = await code(g, '-2 days', '1 hour')

    expect((await sweepOAuthState()).codes).toBe(2)
    for (const id of [valid, recentExpired, recentConsumed, oldButValid])
      expect(await exists('oauth_authorization_codes', id)).toBe(true)
    for (const id of [expiredOld, consumedOld]) expect(await exists('oauth_authorization_codes', id)).toBe(false)
  })
})

describe('refresh tokens', () => {
  it('keeps active tokens and replay evidence; deletes only rows past their window', async () => {
    const g = await grant()
    const active = await refresh(g, { expires: '30 days' })
    const usedRecent = await refresh(g, { expires: '28 days', used: '-2 days' })
    // Used AND expired, but used only 5 days ago: still needed so a replay revokes the family.
    const usedRecentExpired = await refresh(g, { expires: '-3 days', used: '-5 days' })
    const usedOld = await refresh(g, { expires: '-2 days', used: '-31 days' })
    const revokedRecent = await refresh(g, { expires: '20 days', revoked: '-10 days' })
    const revokedOld = await refresh(g, { expires: '-1 day', revoked: '-31 days' })
    const expiredOld = await refresh(g, { expires: '-2 days' })
    const expiredRecent = await refresh(g, { expires: '-1 hour' })

    expect((await sweepOAuthState()).refreshTokens).toBe(3)
    for (const id of [active, usedRecent, usedRecentExpired, revokedRecent, expiredRecent])
      expect(await exists('oauth_refresh_tokens', id)).toBe(true)
    for (const id of [usedOld, revokedOld, expiredOld]) expect(await exists('oauth_refresh_tokens', id)).toBe(false)
  })
})

describe('MCP audit events', () => {
  it('deletes only events older than 180 days; boundary is deterministic', async () => {
    const g = await grant()
    const recent = await audit(g, '-1 day')
    const justInside = await audit(g, '-180 days 1 minute') // 179 days 23:59 ago
    const justOutside = await audit(g, '-180 days -1 minute')
    const old = await audit(g, '-400 days')

    expect((await sweepOAuthState()).audit).toBe(2)
    expect(await exists('mcp_audit_events', recent)).toBe(true)
    expect(await exists('mcp_audit_events', justInside)).toBe(true)
    expect(await exists('mcp_audit_events', justOutside)).toBe(false)
    expect(await exists('mcp_audit_events', old)).toBe(false)
  })

  it('deletes in bounded batches and loops until a short batch', async () => {
    const g = await grant()
    const n = SWEEP_BATCH * 2 + 7
    await db.raw(
      `INSERT INTO mcp_audit_events (request_id, occurred_at, agency_id, user_id, grant_id, client_id, source, tool, kind, params, outcome)
       SELECT gen_random_uuid(), NOW() - interval '200 days', 1, 1, ?, ?, 'claude', 'get_lead', 'read', '{}', 'ok' FROM generate_series(1, ?)`,
      [g, CLIENT, n],
    )
    const keep = await audit(g, '-1 day')
    expect((await sweepOAuthState()).audit).toBe(n)
    expect((await db('mcp_audit_events').pluck('id')).map(Number)).toEqual([keep])
  })
})

describe('grants (children first; the FK cascade never removes anything)', () => {
  it('keeps active and recently revoked grants; deletes an old revoked grant only once it has no children left', async () => {
    const active = await grant()
    await refresh(active, { expires: '30 days' })
    const revokedRecent = await grant('-10 days')
    const revokedOld = await grant('-200 days')

    // Old revoked grant whose audit row is still within the 180-day window.
    const withRecentAudit = await grant('-200 days')
    const recentAuditRow = await audit(withRecentAudit, '-179 days')
    // Old revoked grant whose refresh token is still within its 30-day window.
    const withRecentRefresh = await grant('-200 days')
    const recentRefreshRow = await refresh(withRecentRefresh, { expires: '10 days', revoked: '-20 days' })
    // Old revoked grant whose children are all past retention: everything goes in one run.
    const allOld = await grant('-200 days')
    await audit(allOld, '-190 days')
    await refresh(allOld, { expires: '-170 days', revoked: '-200 days' })
    await code(allOld, '-200 days', '-200 days 2 minutes', '-200 days 1 minute')

    const counts = await sweepOAuthState()
    expect(counts.grants).toBe(2)
    for (const id of [active, revokedRecent, withRecentAudit, withRecentRefresh])
      expect(await exists('oauth_grants', id)).toBe(true)
    for (const id of [revokedOld, allOld]) expect(await exists('oauth_grants', id)).toBe(false)
    // The cascade did not take audit history or replay evidence with it.
    expect(await exists('mcp_audit_events', recentAuditRow)).toBe(true)
    expect(await exists('oauth_refresh_tokens', recentRefreshRow)).toBe(true)
  })
})

describe('idempotency', () => {
  it('a second immediate run deletes nothing and leaves state unchanged', async () => {
    const g = await grant()
    await refresh(g, { expires: '30 days' })
    await code(g, '-2 days', '-2 days 2 minutes')
    await audit(g, '-200 days')
    await audit(g, '-1 day')
    const old = await grant('-300 days')
    await audit(old, '-250 days')

    const first = await sweepOAuthState()
    expect(first).toEqual({ codes: 1, refreshTokens: 0, audit: 2, grants: 1 })
    const after = await snapshot()
    expect(await sweepOAuthState()).toEqual({ codes: 0, refreshTokens: 0, audit: 0, grants: 0 })
    expect(await snapshot()).toEqual(after)
  })
})

describe('cron route', () => {
  const req = (headers: Record<string, string> = {}, method = 'GET') =>
    new NextRequest('https://crm.test/api/cron/oauth-sweep', { method, headers })

  it('fails closed without CRON_SECRET (500) and never sweeps', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const g = await grant()
    const a = await audit(g, '-200 days')
    expect((await GET(req({ authorization: 'Bearer ' }))).status).toBe(500)
    expect(await exists('mcp_audit_events', a)).toBe(true)
  })

  it('rejects a missing, wrong or alternative credential with 403 and never sweeps', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret-123')
    const g = await grant()
    const a = await audit(g, '-200 days')
    for (const h of [
      {},
      { authorization: 'Bearer wrong' },
      { authorization: 'test-cron-secret-123' },
      { authorization: 'Bearer test-cron-secret-1234' },
      { 'x-cron-secret': 'test-cron-secret-123' },
    ]) {
      expect((await GET(req(h))).status).toBe(403)
      expect((await POST(req(h, 'POST'))).status).toBe(403)
    }
    expect(await exists('mcp_audit_events', a)).toBe(true)
  })

  it('the authorized call sweeps and returns counts only; repeated call is a no-op; runs with MCP disabled', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret-123')
    vi.stubEnv('MCP_ENABLED', '0')
    const g = await grant()
    await audit(g, '-200 days')
    const ok = await GET(req({ authorization: 'Bearer test-cron-secret-123' }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, codes: 0, refreshTokens: 0, audit: 1, grants: 0 })
    const again = await GET(req({ authorization: 'Bearer test-cron-secret-123' }))
    expect(await again.json()).toEqual({ ok: true, codes: 0, refreshTokens: 0, audit: 0, grants: 0 })
  })
})
