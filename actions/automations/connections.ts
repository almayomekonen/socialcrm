'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { listAllConnections, listSourcesFor, optionsFor } from '@/lib/automations/connectors/registry'
import type { Connection, ConnectionOption, Source } from '@/lib/automations/catalog/types'

/**
 * The Builder's only door to the Connection layer. Everything crossing it is
 * generic — {id, label} pairs and health states. No integration is named on
 * either side of this boundary.
 */

export type ConnectionsResult = { ok: true; connections: Connection[] } | { ok: false; reason: string }
export type OptionsResult = { ok: true; options: ConnectionOption[] } | { ok: false; reason: string }
export type SourcesResult = { ok: true; sources: Source[] } | { ok: false; reason: string }

async function guard() {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return null
  return user
}

export async function listConnectionsAction(): Promise<ConnectionsResult> {
  const user = await guard()
  if (!user) return { ok: false, reason: 'forbidden' }
  return { ok: true, connections: await listAllConnections(user.agencyId) }
}

export async function listSourcesAction(connectionId: string): Promise<SourcesResult> {
  const user = await guard()
  if (!user) return { ok: false, reason: 'forbidden' }
  return { ok: true, sources: await listSourcesFor(user.agencyId, connectionId) }
}

/** Resolves an `enum_remote` parameter's options via the declared source key. */
export async function listOptionsAction(connectionId: string, optionSource: string): Promise<OptionsResult> {
  const user = await guard()
  if (!user) return { ok: false, reason: 'forbidden' }
  return { ok: true, options: await optionsFor(user.agencyId, connectionId, optionSource) }
}
