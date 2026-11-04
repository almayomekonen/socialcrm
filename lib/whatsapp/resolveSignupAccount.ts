import { COEXISTENCE_GRAPH_VERSION, resolvePhoneNumberIdForWaba } from '@/lib/whatsapp/coexistence'

const GRAPH = `https://graph.facebook.com/${COEXISTENCE_GRAPH_VERSION}`
const GRAPH_LOOKUP_TIMEOUT_MS = 6_000

export type SignupAccount =
  | { wabaId: string; phoneNumberId: string }
  /** `lookup_failed` may be temporary; the others are a fact about the accounts. */
  | { reason: 'lookup_failed' | 'none_found' | 'ambiguous' }

type PhoneRow = { id?: string; is_on_biz_app?: boolean }

async function listPhones(wabaId: string, accessToken: string): Promise<PhoneRow[] | null> {
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,is_on_biz_app`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GRAPH_LOOKUP_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body = (await res.json().catch(() => ({}))) as { data?: PhoneRow[] }
    return (body.data ?? []).filter((row) => row?.id)
  } catch {
    return null
  }
}

/** Same rule as the single-account path: one number, or one on the Business app. */
function loneNumber(rows: PhoneRow[]): string | undefined {
  if (rows.length === 1) return rows[0].id
  const onBizApp = rows.filter((row) => row.is_on_biz_app === true)
  return onBizApp.length === 1 ? onBizApp[0].id : undefined
}

/**
 * Which Messaging account and number this signup connected.
 *
 * Meta can return several accounts. Graph decides, using the customer's own token:
 * the account that holds the number Meta named, or else the only account with one
 * identifiable number. Anything less clear fails: a number can belong to several
 * Messaging accounts, and subscribing the wrong one would connect a number whose
 * templates and billing live elsewhere.
 */
export async function resolveSignupAccount(args: {
  wabaId?: string
  wabaCandidates?: string[]
  phoneNumberId?: string
  accessToken: string
}): Promise<SignupAccount> {
  const { wabaId, wabaCandidates = [], phoneNumberId, accessToken } = args

  if (wabaId) {
    if (phoneNumberId) return { wabaId, phoneNumberId }
    const resolution = await resolvePhoneNumberIdForWaba(wabaId, accessToken)
    if (resolution.phoneNumberId) return { wabaId, phoneNumberId: resolution.phoneNumberId }
    return { reason: resolution.reason ?? 'lookup_failed' }
  }

  const listed = await Promise.all(wabaCandidates.map(async (id) => ({ id, rows: await listPhones(id, accessToken) })))
  const known = listed.filter((a): a is { id: string; rows: PhoneRow[] } => a.rows !== null)
  const lookupFailed = known.length < listed.length

  const matches = phoneNumberId
    ? known.filter((a) => a.rows.some((row) => row.id === phoneNumberId)).map((a) => ({ wabaId: a.id, phoneNumberId }))
    : known.flatMap((a) => {
        const lone = loneNumber(a.rows)
        return lone ? [{ wabaId: a.id, phoneNumberId: lone }] : []
      })

  // A failed lookup could have been a second match, so even one match is not proof.
  if (lookupFailed) return { reason: 'lookup_failed' }
  if (matches.length === 1) return matches[0]
  return { reason: matches.length > 1 || known.some((a) => a.rows.length > 0) ? 'ambiguous' : 'none_found' }
}
