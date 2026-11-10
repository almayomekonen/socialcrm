import { createHash } from 'node:crypto'

/**
 * The ONLY wa_ids that may be sent the `wedding_rsvp` request without a prior wedding
 * invite: seven exact Wedding Manager guests (event 1), each by the SHA-256 of the
 * verified phone (972… E.164 digits). A strict, fixed list — not configuration — so
 * no environment change can widen it, and the numbers stay out of the repository.
 * The Wedding Manager holds the same list, pinned to the guest ids as well.
 *
 * It waives ONLY "must already be invited". Every other RSVP-request check still
 * applies: wedding agency, Israeli mobile, already-requested, the per-guest lock,
 * Lead/conversation resolution, the opt-out gate.
 */
export const DIRECT_RSVP_PHONE_SHA256: ReadonlySet<string> = new Set([
  '97628151c93203842e01c52f135276121a5b5ae27c4ff4c1e625fd03834fc847', // WM guest 613 — נתן ברי
  'c65dc1db8818e2d0690f57642583a6ad7c7ac29810786b08de4fe5da9cfd3377', // WM guest 599 — משה טגביה
  'ef455254c807987db383301ad5e95ea7d22c2d09ae805b51ed958d6d54f2d8a9', // WM guest 600 — אייל אלמו
  '2827509d91824181603c3ad84877a7b8a78bb9c0497de5871690d41bb50d8950', // WM guest 601 — רפאל רמוס
  '2148c7e9b04a7cd5d280c6c64d0d4ae3cb27f3e478bf2c37585a523772aba7cc', // WM guest 603 — לאה בריהון
  '713a6519701e5978744e7f6696a0f5154171b58c00365851acf55b4e794f1311', // WM guest 656 — דניאל מיארה
  '9668861d2754e92e1ae2cd18cfe2df2b09974c3eee78d797daa44807f431661a', // WM guest 663 — אשר יאלו
])

export function rsvpInviteWaived(waId: string, listed: ReadonlySet<string> = DIRECT_RSVP_PHONE_SHA256): boolean {
  return listed.has(createHash('sha256').update(waId).digest('hex'))
}
