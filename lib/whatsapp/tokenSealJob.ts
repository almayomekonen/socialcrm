import 'server-only'
import { createHmac } from 'node:crypto'
import { db } from '@/config/db'
import { deriveSecretSubkey } from '@/lib/crypto/secrets'
import { isSealedWhatsappAccessToken, resolveWhatsappAccessToken, sealWhatsappAccessToken } from '@/lib/whatsapp/connectionToken'

/**
 * One-off sealing of the WhatsApp tokens written in plaintext before sealing existed.
 *
 * It runs INSIDE the production deployment, from a platform-owner Server Action
 * (actions/admin/waTokenSeal.ts), so it uses the deployment's own SECRETS_ENC_KEY and
 * the key never leaves the deployment.
 *
 *   inspect  read-only: counts, plaintext row ids, sealed rows the key cannot open, and
 *            the plan fingerprint that `apply` must present
 *   apply    seals exactly the rows `inspect` reported, or refuses if anything changed
 *
 * SAFETY
 *  · Each token is sealed and then opened again and compared before it is written.
 *  · Compare-and-swap on the value read: a row reconnected meanwhile is left alone.
 *  · Advisory lock: two applies cannot run at once.
 *  · Refuses while any sealed row cannot be opened: that usually means a key mismatch.
 *  · The plan fingerprint covers every plaintext row id and its current value (HMAC with
 *    a derived key, so the fingerprint reveals nothing about a token). Apply refuses a
 *    stale fingerprint, so what runs is exactly what the owner reviewed.
 *  · Results hold counts and row ids only: never a token, a phone number id or the key.
 *  · Only `access_token` is written. Readers accept both formats throughout.
 */

const TABLE = 'whatsapp_connections'
const LOCK_KEY = 'whatsapp_token_seal_job_v1'

export type TokenSealInspection = {
  total: number
  sealed: number
  plaintext: number
  plaintextIds: number[]
  unreadableIds: number[]
  planFingerprint: string
}

export type TokenSealApplyResult =
  | { outcome: 'plan_changed'; inspection: TokenSealInspection }
  | { outcome: 'unreadable_present'; inspection: TokenSealInspection }
  | { outcome: 'nothing_to_seal'; inspection: TokenSealInspection }
  | {
      outcome: 'applied'
      sealedIds: number[]
      changedConcurrentlyIds: number[]
      failedIds: number[]
      after: TokenSealInspection
    }

type Row = { id: number; access_token: string | null }
type Reader = Pick<typeof db, 'raw'> & ((table: string) => ReturnType<typeof db>)

function fingerprint(plaintextRows: Row[]): string {
  const mac = createHmac('sha256', deriveSecretSubkey('whatsapp-token-seal-plan-v1'))
  for (const r of [...plaintextRows].sort((a, b) => a.id - b.id)) mac.update(`${r.id}\u0000${r.access_token ?? ''}\u0001`)
  return mac.digest('hex')
}

async function inspectWith(q: Reader): Promise<TokenSealInspection> {
  const rows = (await q(TABLE).select('id', 'access_token').orderBy('id')) as Row[]
  const plaintextRows = rows.filter((r) => !isSealedWhatsappAccessToken(r.access_token))
  const unreadableIds: number[] = []
  for (const r of rows) {
    if (!isSealedWhatsappAccessToken(r.access_token)) continue
    try {
      if (!resolveWhatsappAccessToken(r.access_token)) throw new Error('empty')
    } catch {
      unreadableIds.push(r.id)
    }
  }
  return {
    total: rows.length,
    sealed: rows.length - plaintextRows.length,
    plaintext: plaintextRows.length,
    plaintextIds: plaintextRows.map((r) => r.id),
    unreadableIds,
    planFingerprint: fingerprint(plaintextRows),
  }
}

/** Read-only. Opens every sealed row with the running key, and fingerprints the plan. */
export async function inspectWhatsappTokens(): Promise<TokenSealInspection> {
  return inspectWith(db as unknown as Reader)
}

/** Test seam only: runs between reading a row and its compare-and-swap write. */
export type TokenSealApplyOptions = { beforeWrite?: (rowId: number) => Promise<void> }

export async function applyWhatsappTokenSeal(expectedFingerprint: string, options: TokenSealApplyOptions = {}): Promise<TokenSealApplyResult> {
  return db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [LOCK_KEY])
    const inspection = await inspectWith(trx as unknown as Reader)
    if (inspection.planFingerprint !== expectedFingerprint) return { outcome: 'plan_changed' as const, inspection }
    // A seal the running key cannot open usually means a key mismatch. Stop and look first.
    if (inspection.unreadableIds.length) return { outcome: 'unreadable_present' as const, inspection }
    if (inspection.plaintext === 0) return { outcome: 'nothing_to_seal' as const, inspection }

    const rows = (await trx(TABLE).whereIn('id', inspection.plaintextIds).select('id', 'access_token')) as Row[]
    const sealedIds: number[] = []
    const changedConcurrentlyIds: number[] = []
    const failedIds: number[] = []
    for (const r of rows) {
      try {
        const original = String(r.access_token ?? '').trim()
        if (!original) throw new Error('empty')
        const sealedValue = sealWhatsappAccessToken(original)
        if (resolveWhatsappAccessToken(sealedValue) !== original) throw new Error('round_trip_mismatch')
        if (options.beforeWrite) await options.beforeWrite(r.id)
        const n = await trx(TABLE).where({ id: r.id, access_token: r.access_token }).update({ access_token: sealedValue })
        if (Number(n) === 1) sealedIds.push(r.id)
        else changedConcurrentlyIds.push(r.id)
      } catch {
        failedIds.push(r.id)
      }
    }
    const after = await inspectWith(trx as unknown as Reader)
    return { outcome: 'applied' as const, sealedIds, changedConcurrentlyIds, failedIds, after }
  })
}
