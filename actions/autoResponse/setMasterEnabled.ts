'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { setMasterEnabled } from '@/db/autoResponseSettings'

/**
 * The mobile kill switch for WhatsApp automatic replies. Master flag only.
 *
 * WHY THIS EXISTS RATHER THAN REUSING `updateAutoResponseSettings`.
 *
 * That action writes ALL SEVEN settings on every call — master, channel,
 * dailyCap, guidance, replyMode, fixedBody, delaySeconds. Driving it from a
 * phone would mean a read-modify-write, and any value the phone held stale
 * would silently overwrite the desktop configuration the owner spent time on.
 * A rep flipping the switch on a bad signal could wipe the guidance text or
 * reset the daily cap, with no error and no way to notice. That is data loss
 * dressed up as a toggle.
 *
 * `setMasterEnabled` is the narrow primitive that already exists in the data
 * layer and touches exactly one column (`agencies.autoResponseEnabled`). This
 * action is a thin authorised wrapper over it — no duplicated query, no second
 * source of truth, and nothing the desktop form owns can be reached from here.
 *
 * AUTHORISATION is the SAME model as `updateAutoResponseSettings`:
 * `requireProductAccess()` then `isAdmin()`. No new permission concept.
 *
 * AGENCY SCOPING is derived from the authenticated session — `user.agencyId`,
 * never an argument. The only parameter is the boolean, so a caller cannot
 * name another tenant's agency even by tampering with the request.
 *
 * NO `revalidatePath`. The toggle is optimistic on the client and the server is
 * the source of truth on the next load; the desktop settings page renders
 * dynamically (it reads the session), so there is no cached output to bust.
 * Revalidating purely to make a switch look updated is the refresh this screen
 * is specified not to do.
 */
export type SetAutoResponseMasterResult = { ok: true } | { ok: false; reason: 'forbidden' | 'failed' }

export async function setAutoResponseMasterEnabled(enabled: boolean): Promise<SetAutoResponseMasterResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }

  try {
    await setMasterEnabled(user.agencyId, !!enabled)
  } catch (err) {
    console.error('[auto-response] master toggle failed', { agencyId: user.agencyId, enabled, err: String(err) })
    return { ok: false, reason: 'failed' }
  }

  return { ok: true }
}
