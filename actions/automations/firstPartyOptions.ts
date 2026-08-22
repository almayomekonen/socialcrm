'use server'

import { requireBasicCrmAccess } from '@/lib/requireUser'
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

/**
 * TIER 2 READ. Renders from rows this agency already owns and sends nothing:
 * the template is loaded from the database and the message or email is composed
 * locally. Showing a customer what their automation WOULD do is the whole point
 * of the teasing experience, so it stays available after a subscription lapses.
 *
 * Execution remains gated at the automation engine, and the admin and allowlist
 * checks below are unchanged.
 */
export async function listFirstPartyOptionsAction(optionSource: string): Promise<FirstPartyOptionsResult> {
  // Same gate as `connections.ts`: the Builder is an admin surface, and this
  // action exists only to populate it.
  const user = await requireBasicCrmAccess()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }
  if (!isAutomationsAgencyAllowlisted(user.agencyId)) return { ok: false, reason: 'not_available' }

  if (!isFirstPartySource(optionSource)) return { ok: false, reason: 'unknown_source' }

  return { ok: true, options: await firstPartyOptionsFor(user.agencyId, optionSource) }
}
