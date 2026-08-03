import 'server-only'
import { db } from '@/config/db'
import { resolveWhatsappStatus } from '@/lib/whatsapp/operationalStatus'
import type { Connection, ConnectionOption, Source } from '../catalog/types'
import type { ConnectionProvider } from './types'

/**
 * The WhatsApp connection provider — the FIRST connector, backing the generic
 * contract with the table this integration already owns.
 *
 * Deliberately no new storage: a Connection here IS a `whatsapp_connections`
 * row, and its Sources are the phone numbers on it. Adopting an existing
 * integration into the Connection layer therefore costs zero migration and
 * zero risk to the shipped WhatsApp behaviour.
 *
 * Everything integration-specific about WhatsApp stops at this file. Nothing
 * above it — not the Builder, not the catalog, not the engine — knows what a
 * WABA is.
 */

const INTEGRATION_KEY = 'whatsapp'

type Row = {
  id: number
  agencyId: number
  phoneNumberId: string | null
  wabaId: string | null
  displayPhoneNumber: string | null
  verifiedName: string | null
}

/** Stable across re-authorisation: the row id, never a label or a token. */
const connectionId = (row: Row) => `whatsapp:${row.id}`

function toConnection(row: Row, health: Connection['health']): Connection {
  return {
    id: connectionId(row),
    integrationKey: INTEGRATION_KEY,
    agencyId: row.agencyId,
    displayName: row.verifiedName || row.displayPhoneNumber || 'וואטסאפ עסקי',
    health,
  }
}

async function rows(agencyId: number): Promise<Row[]> {
  return (await db('whatsapp_connections')
    .select('id', 'agencyId', 'phoneNumberId', 'wabaId', 'displayPhoneNumber', 'verifiedName')
    .where({ agencyId })) as Row[]
}

async function healthOf(row: Row): Promise<Connection['health']> {
  try {
    const status = await resolveWhatsappStatus(row as never, row.agencyId)
    if (status === 'operational') return 'ok'
    if (status === 'needs_verification') return 'needs_reauth'
    return 'degraded'
  } catch {
    return 'degraded'
  }
}

export const whatsappProvider: ConnectionProvider = {
  integrationKey: INTEGRATION_KEY,
  capabilities: ['whatsapp_connected'],

  async listConnections(agencyId) {
    const found = await rows(agencyId)
    return Promise.all(found.map(async (r) => toConnection(r, await healthOf(r))))
  },

  async listSources(agencyId, id) {
    const found = (await rows(agencyId)).filter((r) => connectionId(r) === id)
    return found.flatMap<Source>((r) =>
      r.phoneNumberId
        ? [
            {
              id: r.phoneNumberId, // STABLE id — never the display number
              connectionId: connectionId(r),
              label: r.displayPhoneNumber || r.verifiedName || r.phoneNumberId,
              subscription: r.wabaId ? 'subscribed' : 'pending',
              health: 'ok',
            },
          ]
        : [],
    )
  },

  async options(agencyId, id, optionSource): Promise<ConnectionOption[]> {
    // One declared option source today. An unknown source yields nothing
    // rather than guessing (Law 3).
    if (optionSource !== 'phone_numbers') return []
    const sources = await whatsappProvider.listSources(agencyId, id)
    return sources.map((s) => ({ id: s.id, label: s.label }))
  },
}
