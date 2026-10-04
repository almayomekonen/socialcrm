import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'

const h = vi.hoisted(() => ({ sessionUser: vi.fn(), revalidatePath: vi.fn(), productAccess: vi.fn() }))
vi.mock('@/lib/requireUser', async (orig) => {
  const actual = await orig<typeof import('@/lib/requireUser')>()
  return { ...actual, requireUser: h.sessionUser }
})
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: h.productAccess }))

import { db } from '@/config/db'
import { AuthError } from '@/lib/requireUser'
import { disconnectAiConnection } from '@/actions/oauthGrants'
import { listAiConnections } from '@/lib/oauth/server/connections'
import { upsertActiveGrant, revokeGrant } from '@/lib/oauth/server/grants'
import { issueRefreshToken, rotateRefreshToken } from '@/lib/oauth/server/refreshTokens'
import { signMcpAccessToken } from '@/lib/oauth/server/accessToken'
import { authenticateMcpRequest } from '@/lib/mcp/auth'
import { issueAuthorizationCode } from '@/lib/oauth/server/authorizationCodes'

/**
 * Task 15: Settings lists the session user's own AI connections and disconnects
 * one through the same server action the UI calls.
 */

const RES = 'https://crm.test/api/mcp'
const CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
const CHATGPT = 'https://chatgpt.com/oauth/client.json'
const BOTH = ['crm.leads.read', 'crm.conversations.read']
let A: number, u1: number, u2: number

type Conn = { grantId: number; refresh: string; bearer: string }
async function connect(userId: number, clientId: string, clientName: string): Promise<Conn> {
  const g = await upsertActiveGrant({ userId, agencyId: A, clientId, clientName, resource: RES, scopes: BOTH, sessionVersion: 0 })
  const r = await issueRefreshToken({ grantId: g.id, userId, scopes: BOTH })
  const t = await signMcpAccessToken({ userId, agencyId: A, grantId: g.id, sessionVersion: 0, scopes: BOTH, clientId })
  return { grantId: g.id, refresh: r.token, bearer: `Bearer ${t}` }
}
const authOk = async (bearer: string) =>
  'principal' in
  (await authenticateMcpRequest(new Request(RES, { method: 'POST', headers: { authorization: bearer } }), crypto.randomUUID()))
const grantRow = (id: number) => db('oauth_grants').where({ id }).first('revoked_at', 'revoked_reason')
const refreshRows = (grantId: number) =>
  db('oauth_refresh_tokens').where({ grant_id: grantId }).select('revoked_at', 'revoked_reason')
const asSession = (id: number) => h.sessionUser.mockResolvedValue({ id, agencyId: A, suspended: false })

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__ai_connections__' }).returning('id')
  A = a.id
  const [x] = await db('users').insert({ firstName: 'Uri', lastName: 'One', role: 'AGNT', agencyId: A }).returning('id')
  const [y] = await db('users').insert({ firstName: 'Yael', lastName: 'Two', role: 'AGNT', agencyId: A }).returning('id')
  u1 = x.id
  u2 = y.id
})
beforeEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv('MCP_ENABLED', '1')
  vi.stubEnv('MCP_AGENCY_ALLOWLIST', String(A))
  h.productAccess.mockResolvedValue({ status: 'PAID', hasAccess: true })
  await db.raw(
    'TRUNCATE mcp_audit_events, oauth_refresh_tokens, oauth_authorization_codes, oauth_grants RESTART IDENTITY CASCADE',
  )
  asSession(u1)
})
afterAll(async () => {
  await db.destroy()
})

describe('listing', () => {
  it('the session user sees their own Claude and ChatGPT connections, with Hebrew scope labels', async () => {
    await connect(u1, CLAUDE, 'Claude')
    await connect(u1, CHATGPT, 'ChatGPT')
    await connect(u2, CLAUDE, 'Claude')
    const list = await listAiConnections(u1, A)
    expect(list.map((c) => c.clientLabel).sort()).toEqual(['ChatGPT', 'Claude'])
    for (const c of list) {
      expect(c.scopeLabels).toEqual([
        'צפייה בסיכומי שיחות WhatsApp עם הלידים שלך, ובהודעות עצמן לפי בקשה',
        'צפייה בלידים שלך, במעקבים ובסיכום היומי',
      ])
      expect(Object.keys(c).sort()).toEqual(['clientLabel', 'connectedOn', 'grantId', 'lastUsedOn', 'scopeLabels'])
      expect(c.connectedOn).toMatch(/^\d{1,2}\.\d{1,2}\.\d{4}$/)
    }
    expect(await listAiConnections(u2, A)).toHaveLength(1)
  })

  it('contains no token, code, hash, client metadata URL or internal scope string', async () => {
    const c = await connect(u1, CLAUDE, 'Claude')
    const [grant] = await db('oauth_grants').where({ id: c.grantId }).select('*')
    const code = await issueAuthorizationCode({
      grantId: c.grantId,
      requestJti: crypto.randomUUID(),
      clientId: CLAUDE,
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      codeChallenge: 'x'.repeat(43),
      scopes: BOTH,
      resource: RES,
    })
    const hashes = [
      ...(await db('oauth_refresh_tokens').select('token_hash')).map((r) => r.token_hash),
      ...(await db('oauth_authorization_codes').select('code_hash')).map((r) => r.code_hash),
    ]
    const json = JSON.stringify(await listAiConnections(u1, A))
    for (const secret of [
      c.refresh,
      c.bearer.slice(7),
      code,
      ...hashes,
      CLAUDE,
      RES,
      'crm.leads.read',
      'crm.conversations.read',
      grant.client_id,
    ])
      expect(json).not.toContain(secret)
  })

  it('a grant from another agency is not listed', async () => {
    const [b] = await db('agencies').insert({ name: '__ai_connections_other__' }).returning('id')
    await upsertActiveGrant({
      userId: u1,
      agencyId: b.id,
      clientId: CLAUDE,
      clientName: 'Claude',
      resource: RES,
      scopes: BOTH,
      sessionVersion: 0,
    })
    expect(await listAiConnections(u1, A)).toEqual([])
  })
})

describe('disconnect', () => {
  it('revokes the grant and all its refresh tokens; the SAME access token fails immediately; ChatGPT is untouched', async () => {
    const claude = await connect(u1, CLAUDE, 'Claude')
    await issueRefreshToken({ grantId: claude.grantId, userId: u1, scopes: BOTH }) // a second family
    const chatgpt = await connect(u1, CHATGPT, 'ChatGPT')
    expect(await authOk(claude.bearer)).toBe(true)
    expect(await authOk(chatgpt.bearer)).toBe(true)

    expect(await disconnectAiConnection(claude.grantId)).toEqual({ ok: true })

    expect(await authOk(claude.bearer)).toBe(false)
    expect(await grantRow(claude.grantId)).toMatchObject({ revoked_reason: 'user_disconnect', revoked_at: expect.any(Date) })
    const claudeRefresh = await refreshRows(claude.grantId)
    expect(claudeRefresh).toHaveLength(2)
    for (const r of claudeRefresh) expect(r).toMatchObject({ revoked_reason: 'user_disconnect', revoked_at: expect.any(Date) })
    expect((await rotateRefreshToken(claude.refresh, { resource: RES })).ok).toBe(false)

    expect(await grantRow(chatgpt.grantId)).toEqual({ revoked_at: null, revoked_reason: null })
    expect(await refreshRows(chatgpt.grantId)).toEqual([{ revoked_at: null, revoked_reason: null }])
    expect(await authOk(chatgpt.bearer)).toBe(true)
    expect((await listAiConnections(u1, A)).map((c) => c.clientLabel)).toEqual(['ChatGPT'])
    expect(h.revalidatePath).toHaveBeenCalledTimes(1)
    expect(h.revalidatePath).toHaveBeenCalledWith('/settings/integrations')
  })

  it('repeated disconnect is safe and keeps the original reason and time', async () => {
    const claude = await connect(u1, CLAUDE, 'Claude')
    const other = await connect(u1, CHATGPT, 'ChatGPT')
    expect(await disconnectAiConnection(claude.grantId)).toEqual({ ok: true })
    const first = await grantRow(claude.grantId)
    expect(await disconnectAiConnection(claude.grantId)).toEqual({ ok: true })
    expect(await grantRow(claude.grantId)).toEqual(first)

    // A grant already revoked for another reason keeps that reason.
    await revokeGrant(other.grantId, 'session_revoked')
    const before = await grantRow(other.grantId)
    expect(await disconnectAiConnection(other.grantId)).toEqual({ ok: true })
    expect(await grantRow(other.grantId)).toEqual(before)
    expect((await refreshRows(other.grantId))[0].revoked_reason).toBe('session_revoked')
  })

  it("another user's grant is refused like a missing one, and stays active", async () => {
    const theirs = await connect(u2, CLAUDE, 'Claude')
    const res = await disconnectAiConnection(theirs.grantId)
    expect(res).toEqual({ ok: false, msg: expect.any(String) })
    expect(await disconnectAiConnection(999999)).toEqual(res)
    expect(await grantRow(theirs.grantId)).toEqual({ revoked_at: null, revoked_reason: null })
    expect(await authOk(theirs.bearer)).toBe(true)
    expect(h.revalidatePath).not.toHaveBeenCalled()
  })

  it('a grant of the same user in another agency is refused (session agency only)', async () => {
    const [b] = await db('agencies').insert({ name: '__ai_connections_b2__' }).returning('id')
    const g = await upsertActiveGrant({
      userId: u1,
      agencyId: b.id,
      clientId: CLAUDE,
      clientName: 'Claude',
      resource: RES,
      scopes: BOTH,
      sessionVersion: 0,
    })
    expect((await disconnectAiConnection(g.id)).ok).toBe(false)
    expect(await grantRow(g.id)).toEqual({ revoked_at: null, revoked_reason: null })
  })

  it('malformed ids and a missing session revoke nothing', async () => {
    const mine = await connect(u1, CLAUDE, 'Claude')
    for (const bad of [String(mine.grantId), -1, 0, 1.5, null, undefined, { id: mine.grantId }, [mine.grantId]]) {
      expect((await disconnectAiConnection(bad)).ok).toBe(false)
    }
    h.sessionUser.mockRejectedValue(new AuthError('no_session'))
    expect((await disconnectAiConnection(mine.grantId)).ok).toBe(false)
    expect(await grantRow(mine.grantId)).toEqual({ revoked_at: null, revoked_reason: null })
    expect(await authOk(mine.bearer)).toBe(true)
  })
})
