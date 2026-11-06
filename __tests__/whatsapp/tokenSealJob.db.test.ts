/**
 * The in-deployment job that seals WhatsApp tokens stored in plaintext, and the
 * platform-owner Server Actions that run it, against the real database.
 *
 * Proves: inspect is read-only; apply seals exactly the reviewed plaintext rows and
 * nothing else; a stale fingerprint, a sealed row the key cannot open, a wrong typed
 * confirmation, a non-owner or a suspended owner are all refused with nothing written;
 * a row changed during the run is left alone (compare-and-swap); re-running seals
 * nothing; and no result, log line or audit row contains a token or a phone number id.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  corruptSeal: false,
}))
vi.mock('@/db/auth', async (original) => ({ ...(await original<typeof import('@/db/auth')>()), getUser: async () => h.user }))
vi.mock('@/lib/whatsapp/connectionToken', async (original) => {
  const real = await original<typeof import('@/lib/whatsapp/connectionToken')>()
  // When armed, sealing returns a valid seal of a DIFFERENT token: the job's round-trip check must catch it.
  return { ...real, sealWhatsappAccessToken: (t: string) => real.sealWhatsappAccessToken(h.corruptSeal ? `${t}-corrupted` : t) }
})

import { db } from '@/config/db'
import { applyWhatsappTokenSeal, inspectWhatsappTokens } from '@/lib/whatsapp/tokenSealJob'
import { applyWhatsappTokenSealAction, inspectWhatsappTokensAction } from '@/actions/admin/waTokenSeal'
import { TOKEN_SEAL_CONFIRMATION } from '@/lib/whatsapp/tokenSealConfirmation'
import { isSealedWhatsappAccessToken, resolveWhatsappAccessToken, sealWhatsappAccessToken } from '@/lib/whatsapp/connectionToken'

const P = (n: number) => `__wa_seal_job_${n}__`
const PHONES = [1, 2, 3, 4].map(P)
const TOKENS = {
  a: 'EAAGjobPlaintextTokenAAAAAAAAAAAAAAAAAA1',
  b: 'EAAGjobPlaintextTokenBBBBBBBBBBBBBBBBBB2',
  sealed: 'EAAGjobAlreadySealedCCCCCCCCCCCCCCCCCC3',
  late: 'EAAGjobReconnectedDuringRunDDDDDDDDDDD4',
}
const SECRETS = [...Object.values(TOKENS), ...PHONES]
const OWNER_EMAIL = 'platform-owner@test.invalid'
let agency = 0
let ownerId = 0
const KEY = process.env.SECRETS_ENC_KEY

type Row = { id: number; phone_number_id: string; access_token: string }
const rowsByPhone = async (): Promise<Record<string, Row>> =>
  Object.fromEntries(
    ((await db('whatsapp_connections').whereIn('phone_number_id', PHONES).select('id', 'phone_number_id', 'access_token')) as Row[]).map((r) => [
      r.phone_number_id,
      r,
    ]),
  )

function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value)
  for (const s of SECRETS) expect(text).not.toContain(s)
  expect(text).not.toMatch(/scm1\.[A-Za-z0-9+/]{8}/)
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__wa_seal_job__' }).returning('id')
  agency = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'O', role: 'ADMIN', agencyId: agency }).returning('id')
  ownerId = Number(u.id)
})

beforeEach(async () => {
  await db('whatsapp_connections').whereIn('phone_number_id', PHONES).del()
  await db('whatsapp_connections').insert([
    { user_id: ownerId, agency_id: agency, phone_number_id: P(1), access_token: TOKENS.a },
    { user_id: ownerId, agency_id: agency, phone_number_id: P(2), access_token: ` ${TOKENS.b}\n` },
    { user_id: ownerId, agency_id: agency, phone_number_id: P(3), access_token: sealWhatsappAccessToken(TOKENS.sealed) },
  ])
  h.user = { id: ownerId, agencyId: agency, email: OWNER_EMAIL, suspended: false, role: 'ADMIN' }
  h.corruptSeal = false
  vi.stubEnv('PLATFORM_OWNER_EMAILS', OWNER_EMAIL)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  process.env.SECRETS_ENC_KEY = KEY
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await db('whatsapp_connections').whereIn('phone_number_id', PHONES).del()
  await db('analytics_events').where({ event: 'whatsapp_token_seal_job', userId: ownerId }).del()
  await db('users').where({ agencyId: agency }).del()
  await db('agencies').where({ id: agency }).del()
  await db.destroy()
})

describe('inspect (dry run and verify)', () => {
  it('reports our plaintext rows by id, writes nothing, and returns no token material', async () => {
    const before = await rowsByPhone()
    const i = await inspectWhatsappTokens()
    expect(i.plaintextIds).toEqual(expect.arrayContaining([before[P(1)].id, before[P(2)].id]))
    expect(i.plaintextIds).not.toContain(before[P(3)].id)
    expect(i.unreadableIds).not.toContain(before[P(3)].id)
    expect(i.planFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(await rowsByPhone()).toEqual(before)
    expectNoSecrets(i)
  })

  it('the fingerprint is stable, and changes when a plaintext row changes or appears', async () => {
    const first = (await inspectWhatsappTokens()).planFingerprint
    expect((await inspectWhatsappTokens()).planFingerprint).toBe(first)
    await db('whatsapp_connections').where({ phone_number_id: P(1) }).update({ access_token: `${TOKENS.a}x` })
    const changed = (await inspectWhatsappTokens()).planFingerprint
    expect(changed).not.toBe(first)
    await db('whatsapp_connections').insert({ user_id: ownerId, agency_id: agency, phone_number_id: P(4), access_token: TOKENS.late })
    expect((await inspectWhatsappTokens()).planFingerprint).not.toBe(changed)
  })

  it('flags a sealed row the running key cannot open', async () => {
    const before = await rowsByPhone()
    process.env.SECRETS_ENC_KEY = Buffer.alloc(32, 77).toString('base64')
    expect((await inspectWhatsappTokens()).unreadableIds).toContain(before[P(3)].id)
  })
})

describe('apply', () => {
  it('seals exactly the reviewed rows, leaves sealed rows byte-identical, and the app reads the originals', async () => {
    const before = await rowsByPhone()
    const r = await applyWhatsappTokenSeal((await inspectWhatsappTokens()).planFingerprint)
    expect(r.outcome).toBe('applied')
    if (r.outcome !== 'applied') return
    expect(r.sealedIds).toEqual(expect.arrayContaining([before[P(1)].id, before[P(2)].id]))
    expect(r.failedIds).toEqual([])
    expect(r.after.plaintextIds).not.toContain(before[P(1)].id)
    expectNoSecrets(r)
    const after = await rowsByPhone()
    expect(after[P(3)].access_token).toBe(before[P(3)].access_token)
    for (const p of [P(1), P(2), P(3)]) expect(isSealedWhatsappAccessToken(after[p].access_token)).toBe(true)
    expect(resolveWhatsappAccessToken(after[P(1)].access_token)).toBe(TOKENS.a)
    // Whitespace from a legacy write is trimmed, exactly as the application seals.
    expect(resolveWhatsappAccessToken(after[P(2)].access_token)).toBe(TOKENS.b)
  })

  it('a stale fingerprint is refused and nothing is written', async () => {
    const { planFingerprint } = await inspectWhatsappTokens()
    await db('whatsapp_connections').insert({ user_id: ownerId, agency_id: agency, phone_number_id: P(4), access_token: TOKENS.late })
    const before = await rowsByPhone()
    expect((await applyWhatsappTokenSeal(planFingerprint)).outcome).toBe('plan_changed')
    expect(await rowsByPhone()).toEqual(before)
  })

  it('refuses while a sealed row cannot be opened, writing nothing', async () => {
    process.env.SECRETS_ENC_KEY = Buffer.alloc(32, 77).toString('base64')
    const before = await rowsByPhone()
    const r = await applyWhatsappTokenSeal((await inspectWhatsappTokens()).planFingerprint)
    expect(r.outcome).toBe('unreadable_present')
    expect(await rowsByPhone()).toEqual(before)
  })

  it('a row reconnected during the run is left alone (compare-and-swap) and reported by id', async () => {
    const before = await rowsByPhone()
    const { planFingerprint } = await inspectWhatsappTokens()
    const r = await applyWhatsappTokenSeal(planFingerprint, {
      // A reconnect commits a new sealed token on another connection, after the job read row 1
      // and before its write.
      beforeWrite: async (id) => {
        if (id === before[P(1)].id) {
          await db('whatsapp_connections').where({ id }).update({ access_token: sealWhatsappAccessToken(TOKENS.late) })
        }
      },
    })
    expect(r.outcome).toBe('applied')
    if (r.outcome !== 'applied') return
    expect(r.changedConcurrentlyIds).toEqual([before[P(1)].id])
    expect(r.sealedIds).toContain(before[P(2)].id)
    expect(r.sealedIds).not.toContain(before[P(1)].id)
    // The reconnect's token survived; the job never wrote the stale token over it.
    expect(resolveWhatsappAccessToken((await rowsByPhone())[P(1)].access_token)).toBe(TOKENS.late)
  })

  it('a seal that does not open back to the original token is never written', async () => {
    const before = await rowsByPhone()
    const { planFingerprint } = await inspectWhatsappTokens()
    h.corruptSeal = true
    const r = await applyWhatsappTokenSeal(planFingerprint)
    h.corruptSeal = false
    expect(r.outcome).toBe('applied')
    if (r.outcome !== 'applied') return
    expect(r.failedIds).toEqual(expect.arrayContaining([before[P(1)].id, before[P(2)].id]))
    expect(r.sealedIds).toEqual([])
    const after = await rowsByPhone()
    expect(after[P(1)].access_token).toBe(TOKENS.a)
    expect(after[P(2)].access_token).toBe(before[P(2)].access_token)
  })

  it('a second run seals none of our rows again (idempotent)', async () => {
    await applyWhatsappTokenSeal((await inspectWhatsappTokens()).planFingerprint)
    const before = await rowsByPhone()
    const second = await inspectWhatsappTokens()
    for (const p of [P(1), P(2), P(3)]) expect(second.plaintextIds).not.toContain(before[p].id)
    await applyWhatsappTokenSeal(second.planFingerprint)
    const after = await rowsByPhone()
    for (const p of [P(1), P(2), P(3)]) expect(after[p].access_token).toBe(before[p].access_token)
  })

  it('without the encryption key no row changes and nothing leaks', async () => {
    await db('whatsapp_connections').where({ phone_number_id: P(3) }).del()
    const before = await rowsByPhone()
    const { planFingerprint } = await inspectWhatsappTokens()
    delete process.env.SECRETS_ENC_KEY
    const r = await applyWhatsappTokenSeal(planFingerprint).catch((e) => ({ outcome: 'threw', name: (e as Error).name }))
    expect(await rowsByPhone()).toEqual(before)
    expectNoSecrets(r)
  })
})

describe('platform-owner Server Actions', () => {
  const audits = async () =>
    (await db('analytics_events').where({ event: 'whatsapp_token_seal_job', userId: ownerId }).orderBy('id').select('props')).map(
      (r: { props: unknown }) => r.props,
    )

  it('a non-owner, a suspended owner and an anonymous caller are refused, with nothing written', async () => {
    const before = await rowsByPhone()
    const good = { planFingerprint: 'a'.repeat(64), confirmation: TOKEN_SEAL_CONFIRMATION }
    h.user = { id: ownerId, agencyId: agency, email: 'rep@test.invalid', suspended: false }
    expect(await inspectWhatsappTokensAction()).toEqual({ outcome: 'forbidden' })
    expect(await applyWhatsappTokenSealAction(good)).toEqual({ outcome: 'forbidden' })
    h.user = { id: ownerId, agencyId: agency, email: OWNER_EMAIL, suspended: true }
    expect(await inspectWhatsappTokensAction()).toEqual({ outcome: 'forbidden' })
    expect(await applyWhatsappTokenSealAction(good)).toEqual({ outcome: 'forbidden' })
    h.user = null
    expect(await applyWhatsappTokenSealAction(good)).toEqual({ outcome: 'forbidden' })
    expect(await rowsByPhone()).toEqual(before)
  })

  it('apply needs the exact typed phrase and a well-formed fingerprint; otherwise nothing is written', async () => {
    const before = await rowsByPhone()
    const inspected = await inspectWhatsappTokensAction()
    if (inspected.outcome !== 'ok') throw new Error('inspect failed')
    const fp = inspected.inspection.planFingerprint
    expect(await applyWhatsappTokenSealAction({ planFingerprint: fp, confirmation: 'seal whatsapp tokens' })).toEqual({ outcome: 'invalid' })
    expect(await applyWhatsappTokenSealAction({ planFingerprint: 'not-hex', confirmation: TOKEN_SEAL_CONFIRMATION })).toEqual({ outcome: 'invalid' })
    expect(await applyWhatsappTokenSealAction(null)).toEqual({ outcome: 'invalid' })
    expect(await rowsByPhone()).toEqual(before)
  })

  it('the owner inspects then applies; every call is audited with counts and ids only', async () => {
    const before = await rowsByPhone()
    const inspected = await inspectWhatsappTokensAction()
    if (inspected.outcome !== 'ok') throw new Error('inspect failed')
    const r = await applyWhatsappTokenSealAction({ planFingerprint: inspected.inspection.planFingerprint, confirmation: TOKEN_SEAL_CONFIRMATION })
    expect(r.outcome).toBe('applied')
    expect(resolveWhatsappAccessToken((await rowsByPhone())[P(1)].access_token)).toBe(TOKENS.a)
    const rows = await audits()
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expectNoSecrets(rows)
    expectNoSecrets(vi.mocked(console.log).mock.calls)
    expect(JSON.stringify(rows)).toContain(String(before[P(1)].id))
  })
})
