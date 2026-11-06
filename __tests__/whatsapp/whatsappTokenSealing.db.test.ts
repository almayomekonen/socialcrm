/**
 * WhatsApp tokens sealed at rest, against the real database: the Embedded Signup
 * writer stores only sealed values, and every reader that reaches Meta still gets the
 * usable token, from sealed rows AND from legacy plaintext rows. Nothing here talks to
 * Meta: Graph probes are injected, and the send path is exercised up to the token it
 * would put in the Authorization header.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { saveConnection } from '@/lib/whatsapp/signupSteps'
import {
  isSealedWhatsappAccessToken,
  resolveWhatsappAccessToken,
  sealWhatsappAccessToken,
} from '@/lib/whatsapp/connectionToken'
import { resolveWhatsappOutboundTarget, resolveWhatsappOutboundTargetForConversation } from '@/lib/inbox/whatsappOutboundTarget'
import { getWhatsappConnectionForAgency, listConnectionsMissingWaba } from '@/db/whatsapp'
import { resolveWhatsappHealth, type WhatsappHealthDeps } from '@/lib/whatsapp/operationalStatus'
import { queryConnectionForPhone } from '@/lib/inbox/whatsappComposerContext'

const TOKEN_NEW = 'EAAG_synthetic_new_signup_token_0001'
const TOKEN_LEGACY = 'EAAG_synthetic_legacy_plain_token_02'
const TOKEN_OTHER = 'EAAG_synthetic_other_agency_token_03'
const PHONE_NEW = '__seal_db_phone_new__'
const PHONE_LEGACY = '__seal_db_phone_legacy__'
const PHONE_SPARE = '__seal_db_phone_spare__'
const PHONES = [PHONE_NEW, PHONE_LEGACY, PHONE_SPARE]

let agencyA = 0
let agencyB = 0
let userA = 0
let userB = 0
let leadA = 0
let leadB = 0
const originalKey = process.env.SECRETS_ENC_KEY

const stored = async (phone: string) =>
  (await db('whatsapp_connections').where({ phone_number_id: phone }).first('access_token', 'agency_id'))?.access_token as string | undefined

function probes(seen: string[]): WhatsappHealthDeps {
  return {
    hasInboundForPhone: async () => true,
    hasAccountFailure: async () => false,
    probePhone: async (_p, token) => {
      seen.push(token)
      return { ok: true, status: 'CONNECTED' } as never
    },
    probeSubscribed: async (_w, token) => {
      seen.push(token)
      return { ok: true, subscribed: true } as never
    },
  }
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__seal_db_a__' }).returning('id')
  const [b] = await db('agencies').insert({ name: '__seal_db_b__' }).returning('id')
  agencyA = Number(a.id)
  agencyB = Number(b.id)
  const [ua] = await db('users').insert({ firstName: 'A', role: 'ADMIN', agencyId: agencyA }).returning('id')
  const [ub] = await db('users').insert({ firstName: 'B', role: 'ADMIN', agencyId: agencyB }).returning('id')
  userA = Number(ua.id)
  userB = Number(ub.id)
  const lead = async (agencyId: number, userId: number) =>
    Number(
      (
        await db('clients')
          .insert({ firstName: 'ל', lastName: 'ד', agencyId, createdById: userId, userId, phone: '972500000000' } as never)
          .returning('id')
      )[0].id,
    )
  leadA = await lead(agencyA, userA)
  leadB = await lead(agencyB, userB)
  // A row written before sealing existed: plaintext, as 6 of 7 production rows are today.
  await db('whatsapp_connections').insert({ user_id: userB, agency_id: agencyB, phone_number_id: PHONE_LEGACY, access_token: TOKEN_LEGACY, waba_id: null })
})

afterEach(() => {
  process.env.SECRETS_ENC_KEY = originalKey
  vi.restoreAllMocks()
})

afterAll(async () => {
  await db('inbox_conversations').whereIn('businessPhoneNumberId', PHONES).del()
  await db('whatsapp_connections').whereIn('phone_number_id', PHONES).del()
  await db('clients').whereIn('agencyId', [agencyA, agencyB]).del()
  await db('users').whereIn('agencyId', [agencyA, agencyB]).del()
  await db('agencies').whereIn('id', [agencyA, agencyB]).del()
  await db.destroy()
})

describe('writers store only sealed tokens', () => {
  it('Embedded Signup saves a sealed token that opens to the token Meta issued', async () => {
    const result = await saveConnection({ user_id: userA, agency_id: agencyA, phone_number_id: PHONE_NEW, access_token: TOKEN_NEW, waba_id: 'W_A', onboarding_type: 'cloud_api' })
    expect(result).toBe('saved')
    const value = await stored(PHONE_NEW)
    expect(value).toBeDefined()
    expect(value).not.toContain(TOKEN_NEW)
    expect(isSealedWhatsappAccessToken(value)).toBe(true)
    expect(resolveWhatsappAccessToken(value)).toBe(TOKEN_NEW)
  })

  it('a reconnect by the same agency replaces the token, still sealed', async () => {
    const before = await stored(PHONE_NEW)
    expect(await saveConnection({ user_id: userA, agency_id: agencyA, phone_number_id: PHONE_NEW, access_token: `${TOKEN_NEW}_v2`, waba_id: 'W_A', onboarding_type: 'cloud_api' })).toBe('saved')
    const after = await stored(PHONE_NEW)
    expect(after).not.toBe(before)
    expect(isSealedWhatsappAccessToken(after)).toBe(true)
    expect(resolveWhatsappAccessToken(after)).toBe(`${TOKEN_NEW}_v2`)
  })

  it('another agency cannot take the number, and the owner’s sealed token is untouched', async () => {
    const before = await stored(PHONE_NEW)
    expect(await saveConnection({ user_id: userB, agency_id: agencyB, phone_number_id: PHONE_NEW, access_token: TOKEN_OTHER, waba_id: 'W_B', onboarding_type: 'cloud_api' })).toBe('claimed')
    expect(await stored(PHONE_NEW)).toBe(before)
  })

  it('without the encryption key the save fails and nothing is written, never plaintext', async () => {
    delete process.env.SECRETS_ENC_KEY
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await saveConnection({ user_id: userA, agency_id: agencyA, phone_number_id: PHONE_SPARE, access_token: TOKEN_NEW, waba_id: 'W_A', onboarding_type: 'cloud_api' })).toBe('failed')
    expect(await stored(PHONE_SPARE)).toBeUndefined()
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(' ')
    expect(logged).not.toContain(TOKEN_NEW)
  })
})

describe('readers that reach Meta get the usable token from sealed and legacy rows', () => {
  it('the send target (replies, IRE, automations, templates) resolves both formats', async () => {
    const sealedTarget = await resolveWhatsappOutboundTarget(agencyA, leadA)
    const legacyTarget = await resolveWhatsappOutboundTarget(agencyB, leadB)
    expect(sealedTarget.ok && sealedTarget.target.accessToken).toBe(`${TOKEN_NEW}_v2`)
    expect(legacyTarget.ok && legacyTarget.target.accessToken).toBe(TOKEN_LEGACY)
  })

  it('the conversation-scoped send target resolves a sealed token', async () => {
    const [conv] = await db('inbox_conversations')
      .insert({ agencyId: agencyA, leadId: leadA, channel: 'whatsapp', businessPhoneNumberId: PHONE_NEW, customerWaId: '972500000000' })
      .returning('id')
    const target = await resolveWhatsappOutboundTargetForConversation(agencyA, leadA, Number(conv.id))
    expect(target.ok && target.target.accessToken).toBe(`${TOKEN_NEW}_v2`)
  })

  it('the agency connection read and the waba backfill read hand out the usable token', async () => {
    expect((await getWhatsappConnectionForAgency(agencyA))?.access_token).toBe(`${TOKEN_NEW}_v2`)
    expect((await getWhatsappConnectionForAgency(agencyB))?.access_token).toBe(TOKEN_LEGACY)
    const missing = await listConnectionsMissingWaba()
    const legacy = missing.find((r) => r.phone_number_id === PHONE_LEGACY)
    expect(legacy?.access_token).toBe(TOKEN_LEGACY)
    // A sealed row with no waba yet must also come back usable.
    await db('whatsapp_connections').where({ phone_number_id: PHONE_NEW }).update({ waba_id: null })
    const sealedRow = (await listConnectionsMissingWaba()).find((r) => r.phone_number_id === PHONE_NEW)
    expect(sealedRow?.access_token).toBe(`${TOKEN_NEW}_v2`)
    await db('whatsapp_connections').where({ phone_number_id: PHONE_NEW }).update({ waba_id: 'W_A' })
  })

  it('the health probe (composer, connections page, hourly sweep) sends Meta the usable token, never the seal', async () => {
    const seen: string[] = []
    const conn = await queryConnectionForPhone(agencyA, PHONE_NEW)
    expect(isSealedWhatsappAccessToken(conn?.access_token)).toBe(true)
    const health = await resolveWhatsappHealth(conn, agencyA, probes(seen))
    expect(health.primary).not.toBe('token')
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((t) => t === `${TOKEN_NEW}_v2`)).toBe(true)
  })

  it('a sealed row the running key cannot open fails loudly instead of sending a broken token', async () => {
    process.env.SECRETS_ENC_KEY = Buffer.alloc(32, 99).toString('base64')
    await expect(resolveWhatsappOutboundTarget(agencyA, leadA)).rejects.toThrow()
    // Legacy rows are unaffected by the key.
    const legacy = await resolveWhatsappOutboundTarget(agencyB, leadB)
    expect(legacy.ok && legacy.target.accessToken).toBe(TOKEN_LEGACY)
  })

  it('a token sealed by the helper is accepted by the readers exactly like one written through signup', async () => {
    const value = sealWhatsappAccessToken(TOKEN_OTHER)
    await db('whatsapp_connections').insert({ user_id: userA, agency_id: agencyA, phone_number_id: PHONE_SPARE, access_token: value, waba_id: 'W_S' })
    const seen: string[] = []
    await resolveWhatsappHealth({ phone_number_id: PHONE_SPARE, access_token: value, waba_id: 'W_S' }, agencyA, probes(seen))
    expect(seen.every((t) => t === TOKEN_OTHER)).toBe(true)
  })
})
