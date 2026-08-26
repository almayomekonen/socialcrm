/**
 * Tell a Cloud API message id apart from a WhatsApp Business app one.
 *
 * Meta sends `statuses` webhooks for BOTH the messages we send through Cloud API
 * and the messages a Coexistence business sends from the WhatsApp Business app on
 * their own phone. We persist only the former — `smb_message_echoes` is
 * acknowledged and deliberately not stored (`lib/whatsapp/coexistence.ts`) — so a
 * status for one of the latter can never match a row. That is expected traffic,
 * not a lost event, and it must not be logged as though something went wrong.
 *
 * The two id families are structurally different once base64-decoded:
 *
 *   Cloud API     1c 18 0c <recipient msisdn>      15 02 00 11 18 14 <hex> 00
 *   Business app  1c 18 13 "IL.1739721384036504"   15 14 00 11 18 14 <hex> 00
 *                                                  ^^^^^^^^
 *
 * The marker byte after 0x15 is the discriminator. It cannot collide with the
 * rest of the payload: every other region is printable ASCII (digits, `.`, and
 * uppercase hex), so the bytes 0x02 and 0x00 appear nowhere else in sequence.
 *
 * Verified against production on 2026-08-26: all 1,556 persisted wamids
 * (1,455 inbound + 101 outbound) carry the Cloud API marker, with no exceptions,
 * while every unmatched status wamid sampled over six days carried the business
 * app shape instead (`IL.` and `GE.` prefixes, across three agencies).
 *
 * Detection is on the id itself, NOT on `whatsapp_connections.onboarding_type`:
 * agency 103 is stored as `cloud_api` yet emits business app ids, so the stored
 * hint misclassifies. Graph's authoritative `is_on_biz_app` is not persisted in
 * any table, and fetching it per status event would put a network round trip in
 * the webhook hot path.
 */

/** The three bytes that only ever appear in a Cloud API id. */
const CLOUD_API_MARKER = Buffer.from([0x15, 0x02, 0x00])

/** The business-app counterpart. Must be matched POSITIVELY — see below. */
const BUSINESS_APP_MARKER = Buffer.from([0x15, 0x14, 0x00])

/**
 * Is this a Cloud API wamid — i.e. an id for a message WE sent, whose status is
 * expected to match a row?
 *
 * Both families are matched positively and everything else answers `true`, ON
 * PURPOSE. This classification decides whether an unmatched status is warned
 * about, so the two failure modes are not symmetric: logging one benign event
 * too many costs nothing, while silencing a genuinely lost event costs the only
 * signal we have. An id we cannot recognise must therefore land on the noisy
 * side — including base64 that decodes to bytes carrying neither marker.
 */
export function isCloudApiWamid(wamid: string | null | undefined): boolean {
  if (!wamid) return true
  const encoded = wamid.startsWith('wamid.') ? wamid.slice('wamid.'.length) : wamid
  try {
    const decoded = Buffer.from(encoded, 'base64')
    if (decoded.length === 0) return true
    if (decoded.includes(CLOUD_API_MARKER)) return true
    return !decoded.includes(BUSINESS_APP_MARKER)
  } catch {
    return true
  }
}
