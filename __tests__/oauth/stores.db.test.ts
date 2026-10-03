import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { db } from '@/config/db'
import { upsertActiveGrant, getActiveGrant, revokeGrant, listActiveGrantsForUser, touchGrant } from '@/lib/oauth/server/grants'
import { issueAuthorizationCode, consumeAuthorizationCode, CODE_TTL_SECONDS } from '@/lib/oauth/server/authorizationCodes'
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshFamilyByToken,
  REFRESH_TTL_DAYS,
} from '@/lib/oauth/server/refreshTokens'
import { sha256Hex } from '@/lib/oauth/server/hash'

const CLIENT = 'https://chatgpt.com/oauth/client.json'
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect'
const RES = 'https://crm.test/api/mcp'
// RFC 7636 Appendix B.
const V = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const C = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

const grantInput = (over: Partial<Parameters<typeof upsertActiveGrant>[0]> = {}) => ({
  userId: 11,
  agencyId: 1,
  clientId: CLIENT,
  clientName: 'ChatGPT',
  resource: RES,
  scopes: ['crm.leads.read'],
  sessionVersion: 0,
  ...over,
})
const grant = (over: Partial<Parameters<typeof upsertActiveGrant>[0]> = {}) => upsertActiveGrant(grantInput(over))
const codeFor = (grantId: number, over: Partial<Parameters<typeof issueAuthorizationCode>[0]> = {}) =>
  issueAuthorizationCode({
    grantId,
    requestJti: randomUUID(),
    clientId: CLIENT,
    redirectUri: REDIRECT,
    codeChallenge: C,
    scopes: ['crm.leads.read'],
    resource: RES,
    ...over,
  })
const check = { clientId: CLIENT, redirectUri: REDIRECT, resource: RES, codeVerifier: V }

beforeEach(async () => {
  await db.raw(
    'TRUNCATE mcp_audit_events, oauth_refresh_tokens, oauth_authorization_codes, oauth_grants RESTART IDENTITY CASCADE',
  )
})
afterAll(async () => {
  await db.destroy()
})

// ─────────────────────────────────────────────────────────────────── grants ──
describe('grants', () => {
  it('creates an active grant with sorted scopes', async () => {
    const g = await grant({ scopes: ['crm.conversations.read', 'crm.leads.read'] })
    expect(g).toMatchObject({ userId: 11, agencyId: 1, clientId: CLIENT, resource: RES, sessionVersion: 0, lastUsedAt: null })
    expect(g.scopes).toEqual(['crm.conversations.read', 'crm.leads.read'])
    expect(await getActiveGrant(g.id)).toMatchObject({ id: g.id })
  })

  it('re-authorizing reuses the active grant, unions scopes and refreshes the session snapshot', async () => {
    const g1 = await grant()
    const g2 = await grant({ scopes: ['crm.conversations.read'], sessionVersion: 3, clientName: 'ChatGPT 2' })
    expect(g2.id).toBe(g1.id)
    expect(g2.scopes).toEqual(['crm.conversations.read', 'crm.leads.read'])
    expect(g2.sessionVersion).toBe(3)
    expect(g2.clientName).toBe('ChatGPT 2')
    expect(await db('oauth_grants').count<{ n: string }[]>('* as n')).toEqual([{ n: '1' }])
  })

  it('a different client or resource is a different grant', async () => {
    const a = await grant()
    const b = await grant({ clientId: 'https://chatgpt.com/other.json' })
    const c = await grant({ resource: 'https://crm.test/api/other' })
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
  })

  it('CONCURRENT re-consent for the same (user, client, resource) yields one active grant', async () => {
    const results = await Promise.all([grant(), grant({ scopes: ['crm.conversations.read'] })])
    expect(results[0].id).toBe(results[1].id)
    const active = await db('oauth_grants').whereNull('revoked_at').select('id', 'scopes')
    expect(active).toHaveLength(1)
    expect([...active[0].scopes].sort()).toEqual(['crm.conversations.read', 'crm.leads.read'])
  })

  it('after revocation, re-consent creates a NEW grant; the revoked row stays revoked', async () => {
    const g1 = await grant()
    await revokeGrant(g1.id, 'user_disconnect')
    const g2 = await grant()
    expect(g2.id).not.toBe(g1.id)
    expect(await getActiveGrant(g1.id)).toBeNull()
    const old = await db('oauth_grants').where({ id: g1.id }).first('revoked_at', 'revoked_reason')
    expect(old.revoked_at).not.toBeNull()
    expect(old.revoked_reason).toBe('user_disconnect')
  })

  it('revoking a grant revokes all its refresh tokens with the same reason; it is idempotent', async () => {
    const g = await grant()
    await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
    await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
    await revokeGrant(g.id, 'session_revoked')
    await revokeGrant(g.id, 'admin') // second call must not overwrite the first reason
    expect(await getActiveGrant(g.id)).toBeNull()
    const tokens = await db('oauth_refresh_tokens').where({ grant_id: g.id }).select('revoked_at', 'revoked_reason')
    expect(tokens).toHaveLength(2)
    for (const t of tokens) expect(t).toMatchObject({ revoked_reason: 'session_revoked' })
    expect((await db('oauth_grants').where({ id: g.id }).first('revoked_reason')).revoked_reason).toBe('session_revoked')
  })

  it('lists only the active grants of that user', async () => {
    const mine = await grant()
    const revoked = await grant({ clientId: 'https://chatgpt.com/old.json' })
    await revokeGrant(revoked.id, 'user_disconnect')
    await grant({ userId: 99 })
    expect((await listActiveGrantsForUser(11)).map((g) => g.id)).toEqual([mine.id])
  })

  it('touchGrant writes last_used_at at most once per 5 minutes', async () => {
    const g = await grant()
    await touchGrant(g.id)
    const first = (await getActiveGrant(g.id))!.lastUsedAt
    expect(first).not.toBeNull()
    await touchGrant(g.id)
    expect((await getActiveGrant(g.id))!.lastUsedAt).toEqual(first)
    await db('oauth_grants')
      .where({ id: g.id })
      .update({ last_used_at: db.raw("NOW() - interval '6 minutes'") })
    await touchGrant(g.id)
    expect((await getActiveGrant(g.id))!.lastUsedAt!.getTime()).toBeGreaterThan(first!.getTime())
  })
})

// ────────────────────────────────────────────────────── authorization codes ──
describe('authorization codes', () => {
  it('stores only the SHA-256 hash, with a short expiry', async () => {
    const g = await grant()
    const code = await codeFor(g.id)
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const row = await db('oauth_authorization_codes').first(
      'code_hash',
      db.raw('EXTRACT(EPOCH FROM (expires_at - created_at)) AS ttl'),
    )
    expect(row.code_hash).toBe(sha256Hex(code))
    expect(row.code_hash).not.toContain(code)
    expect(Math.round(Number(row.ttl))).toBe(CODE_TTL_SECONDS)
    expect(CODE_TTL_SECONDS).toBe(120)
  })

  it('exchanges once; a replay revokes the grant and its tokens', async () => {
    const g = await grant()
    await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
    const code = await codeFor(g.id)
    expect(await consumeAuthorizationCode(code, check)).toEqual({
      ok: true,
      grantId: g.id,
      scopes: ['crm.leads.read'],
      resource: RES,
    })
    expect(await consumeAuthorizationCode(code, check)).toEqual({ ok: false, reason: 'replayed' })
    expect(await getActiveGrant(g.id)).toBeNull()
    expect(await db('oauth_refresh_tokens').where({ grant_id: g.id }).whereNull('revoked_at')).toHaveLength(0)
  })

  it('CONCURRENT exchange of the same code: exactly one success, the other is a replay', async () => {
    const g = await grant()
    const code = await codeFor(g.id)
    const results = await Promise.all([consumeAuthorizationCode(code, check), consumeAuthorizationCode(code, check)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => 'reason' in r && r.reason === 'replayed')).toHaveLength(1)
    expect(await getActiveGrant(g.id)).toBeNull()
  })

  it('one pending request (request_jti) can mint only one code', async () => {
    const g = await grant()
    const jti = randomUUID()
    await codeFor(g.id, { requestJti: jti })
    await expect(codeFor(g.id, { requestJti: jti })).rejects.toThrow(/duplicate key|unique/i)
  })

  it.each([
    ['wrong verifier', { codeVerifier: 'e' + V.slice(1) }],
    ['malformed verifier', { codeVerifier: 'short' }],
    ['wrong redirect_uri', { redirectUri: REDIRECT + '/' }],
    ['wrong resource', { resource: 'https://crm.test/api/other' }],
    ['wrong client', { clientId: 'https://chatgpt.com/other.json' }],
  ])('%s → mismatch, and the code is burned (never usable later)', async (_n, override) => {
    const g = await grant()
    const code = await codeFor(g.id)
    expect(await consumeAuthorizationCode(code, { ...check, ...override })).toEqual({ ok: false, reason: 'mismatch' })
    expect((await consumeAuthorizationCode(code, check)).ok).toBe(false)
  })

  it('an expired code is refused and burned', async () => {
    const g = await grant()
    const code = await codeFor(g.id)
    await db('oauth_authorization_codes').update({ expires_at: db.raw("NOW() - interval '1 second'") })
    expect(await consumeAuthorizationCode(code, check)).toEqual({ ok: false, reason: 'expired' })
    expect((await consumeAuthorizationCode(code, check)).ok).toBe(false)
  })

  it('a code whose grant was revoked is refused', async () => {
    const g = await grant()
    const code = await codeFor(g.id)
    await revokeGrant(g.id, 'user_disconnect')
    expect(await consumeAuthorizationCode(code, check)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('an unknown code is invalid and changes nothing', async () => {
    const g = await grant()
    expect(await consumeAuthorizationCode('not-a-real-code', check)).toEqual({ ok: false, reason: 'invalid' })
    expect(await getActiveGrant(g.id)).not.toBeNull()
  })
})

// ───────────────────────────────────────────────────────────── refresh tokens ──
describe('refresh tokens', () => {
  it('stores only the SHA-256 hash with a 30-day expiry', async () => {
    const g = await grant()
    const t = await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
    expect(t.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const row = await db('oauth_refresh_tokens').first(
      'token_hash',
      'family_id',
      db.raw('EXTRACT(EPOCH FROM (expires_at - issued_at)) AS ttl'),
    )
    expect(row.token_hash).toBe(sha256Hex(t.token))
    expect(row.family_id).toBe(t.familyId)
    expect(Math.round(Number(row.ttl))).toBe(REFRESH_TTL_DAYS * 86_400)
  })

  it('rotates: the old token dies, the successor works, same family', async () => {
    const g = await grant()
    const first = await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
    const r1 = await rotateRefreshToken(first.token, { resource: RES })
    expect(r1).toMatchObject({ ok: true, familyId: first.familyId, grantId: g.id, userId: 11, scopes: ['crm.leads.read'] })
    if (!r1.ok) return
    expect(r1.token).not.toBe(first.token)
    const r2 = await rotateRefreshToken(r1.token, { resource: RES })
    expect(r2).toMatchObject({ ok: true, familyId: first.familyId })
  })

  it('reuse of a used token revokes the whole family AND the grant (and the revocation is committed)', async () => {
    const g = await grant()
    const first = await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
    const r1 = await rotateRefreshToken(first.token, { resource: RES })
    expect(r1.ok).toBe(true)
    expect(await rotateRefreshToken(first.token, { resource: RES })).toEqual({ ok: false, reason: 'reuse' })
    if (r1.ok) expect(await rotateRefreshToken(r1.token, { resource: RES })).toEqual({ ok: false, reason: 'revoked' })
    expect(await getActiveGrant(g.id)).toBeNull()
    const reasons = await db('oauth_refresh_tokens').where({ family_id: first.familyId }).pluck('revoked_reason')
    expect(reasons.every((r) => r === 'refresh_reuse')).toBe(true)
    expect((await db('oauth_grants').where({ id: g.id }).first('revoked_reason')).revoked_reason).toBe('refresh_reuse')
  })

  it('CONCURRENT presentation of the same token: exactly one success, one reuse, family + grant revoked', async () => {
    const g = await grant()
    const first = await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
    const results = await Promise.all([
      rotateRefreshToken(first.token, { resource: RES }),
      rotateRefreshToken(first.token, { resource: RES }),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => 'reason' in r && r.reason === 'reuse')).toHaveLength(1)
    // No live, unused successor survives the replay handling.
    const live = await db('oauth_refresh_tokens')
      .where({ family_id: first.familyId })
      .whereNull('revoked_at')
      .whereNull('used_at')
    expect(live).toHaveLength(0)
    expect(await getActiveGrant(g.id)).toBeNull()
    // The winner's successor is unusable.
    const winner = results.find((r) => r.ok)
    if (winner && winner.ok) expect((await rotateRefreshToken(winner.token, { resource: RES })).ok).toBe(false)
  })

  it('CONCURRENT presentation is deterministic across repeated runs', async () => {
    for (let i = 0; i < 5; i++) {
      await db.raw('TRUNCATE oauth_refresh_tokens, oauth_authorization_codes, oauth_grants RESTART IDENTITY CASCADE')
      const g = await grant()
      const first = await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
      const results = await Promise.all([
        rotateRefreshToken(first.token, { resource: RES }),
        rotateRefreshToken(first.token, { resource: RES }),
        rotateRefreshToken(first.token, { resource: RES }),
      ])
      expect(
        results.filter((r) => r.ok),
        `run ${i}`,
      ).toHaveLength(1)
      expect(
        results.filter((r) => 'reason' in r && r.reason === 'reuse'),
        `run ${i}`,
      ).toHaveLength(2)
      expect(await getActiveGrant(g.id), `run ${i}`).toBeNull()
    }
  })

  it('cannot widen scopes; may narrow them', async () => {
    const g = await grant({ scopes: ['crm.conversations.read', 'crm.leads.read'] })
    const narrowGrant = await grant({ clientId: 'https://chatgpt.com/narrow.json' })
    const wide = await issueRefreshToken({ grantId: narrowGrant.id, userId: 11, scopes: narrowGrant.scopes })
    expect(await rotateRefreshToken(wide.token, { resource: RES, requestedScopes: ['crm.conversations.read'] })).toEqual({
      ok: false,
      reason: 'invalid_scope',
    })
    const t = await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
    const narrowed = await rotateRefreshToken(t.token, { resource: RES, requestedScopes: ['crm.leads.read'] })
    expect(narrowed).toMatchObject({ ok: true, scopes: ['crm.leads.read'] })
  })

  it('a rejected scope/resource request leaves the token unused (not burned)', async () => {
    const g = await grant()
    const t = await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
    expect(await rotateRefreshToken(t.token, { resource: 'https://crm.test/x' })).toEqual({ ok: false, reason: 'invalid_target' })
    expect((await rotateRefreshToken(t.token, { resource: RES })).ok).toBe(true)
  })

  it('unknown, expired and revoked tokens fail closed', async () => {
    expect(await rotateRefreshToken('nope', { resource: RES })).toEqual({ ok: false, reason: 'invalid' })
    const g = await grant()
    const t = await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
    await db('oauth_refresh_tokens').update({ expires_at: db.raw("NOW() - interval '1 second'") })
    expect(await rotateRefreshToken(t.token, { resource: RES })).toEqual({ ok: false, reason: 'expired' })

    const t2 = await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
    await revokeGrant(g.id, 'user_disconnect')
    expect(await rotateRefreshToken(t2.token, { resource: RES })).toEqual({ ok: false, reason: 'revoked' })
  })

  it('RFC 7009 revocation revokes the presented token family only; unknown tokens are a no-op', async () => {
    const g = await grant()
    const a = await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
    const b = await issueRefreshToken({ grantId: g.id, userId: 11, scopes: g.scopes })
    await revokeRefreshFamilyByToken(a.token)
    await revokeRefreshFamilyByToken('unknown')
    expect(await rotateRefreshToken(a.token, { resource: RES })).toEqual({ ok: false, reason: 'revoked' })
    expect((await rotateRefreshToken(b.token, { resource: RES })).ok).toBe(true)
  })
})
