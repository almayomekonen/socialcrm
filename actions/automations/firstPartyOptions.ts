'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import { firstPartyOptionsFor, isFirstPartySource } from '@/lib/automations/firstPartyOptions'
import type { ConnectionOption } from '@/lib/automations/catalog/types'

/**
 * The Builder's door to FIRST-PARTY option sources — the agency's own data.
 *
 * The counterpart of `listOptionsAction` / `listOptionsForCapabilityAction` in
 * `connections.ts`, and separate for the same reason the parameter type is: those
 * resolve through a connector and answer `[]` without a connection, which is the
 * wrong answer for data that has no connection to begin with.
 *
 * Everything crossing this boundary stays generic — `{id, label}` pairs. The
 * Builder learns a source KEY from catalog metadata and nothing about what the
 * options mean, which is Law 1 for this control.
 *
 * THE CLIENT CANNOT NAME AN ARBITRARY SOURCE. `optionSource` is checked against
 * the closed `FIRST_PARTY_SOURCES` vocabulary before anything is read, so a
 * caller chooses among server-defined sources rather than supplying one. An
 * unregistered key is refused with a reason, never served as an empty list —
 * empty and forbidden must not look alike.
 *
 * `agencyId` is never accepted from the wire: it comes from the session, and the
 * domain primitive scopes every read by it.
 */

export type FirstPartyOptionsResult = { ok: true; options: ConnectionOption[] } | { ok: false; reason: string }

export async function listFirstPartyOptionsAction(optionSource: string): Promise<FirstPartyOptionsResult> {
  // Same gate as `connections.ts`: the Builder is an admin surface, and this
  // action exists only to populate it.
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }
  if (!isAutomationsAgencyAllowlisted(user.agencyId)) return { ok: false, reason: 'not_available' }

  if (!isFirstPartySource(optionSource)) return { ok: false, reason: 'unknown_source' }

  return { ok: true, options: await firstPartyOptionsFor(user.agencyId, optionSource) }
}
