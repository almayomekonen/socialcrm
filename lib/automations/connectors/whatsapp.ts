import 'server-only'
import { db } from '@/config/db'
import { resolveWhatsappHealth } from '@/lib/whatsapp/operationalStatus'
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

/**
 * The row as `whatsapp_connections` ACTUALLY stores it: snake_case, and only the
 * five columns that exist (`id, user_id, agency_id, phone_number_id,
 * access_token, waba_id`).
 *
 * This shape is load-bearing rather than cosmetic. The columns previously read
 * here — `agencyId`, `phoneNumberId`, `wabaId`, `displayPhoneNumber`,
 * `verifiedName` — are not on the table and never were, so every query threw an
 * unknown-column error. `resolve.ts` wraps provider calls in `safe()`, which
 * turns a throw into "answered nothing" — so the failure was completely silent:
 * `listConnections` always returned empty, which meant `whatsapp_connected` was
 * never granted to any agency, which meant every requirement gated on it stayed
 * locked forever with no error anywhere.
 *
 * There is no stored display name or display number to show. Rather than invent
 * one, the label falls back to the phone number id — a real value the business
 * can recognise — and never to a fabricated name.
 */
type Row = {
  id: number
  agency_id: number
  phone_number_id: string | null
  access_token: string
  waba_id: string | null
}

/** Stable across re-authorisation: the row id, never a label or a token. */
const connectionId = (row: Row) => `whatsapp:${row.id}`

function toConnection(row: Row, health: Connection['health']): Connection {
  return {
    id: connectionId(row),
    integrationKey: INTEGRATION_KEY,
    agencyId: row.agency_id,
    displayName: 'וואטסאפ עסקי',
    health,
  }
}

async function rows(agencyId: number): Promise<Row[]> {
  return (await db('whatsapp_connections')
    .select('id', 'agency_id', 'phone_number_id', 'access_token', 'waba_id')
    .where({ agency_id: agencyId })) as Row[]
}

async function healthOf(row: Row): Promise<Connection['health']> {
  try {
    if (!row.phone_number_id) return 'degraded'
    const { primary } = await resolveWhatsappHealth(
      {
        phone_number_id: row.phone_number_id,
        access_token: row.access_token,
        waba_id: row.waba_id,
      },
      row.agency_id,
    )
    if (primary === 'operational') return 'ok'
    if (primary === 'token' || primary === 'unknown' || primary === 'webhook') return 'needs_reauth'
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
      r.phone_number_id
        ? [
            {
              id: r.phone_number_id, // STABLE id — never a display number
              connectionId: connectionId(r),
              label: r.phone_number_id,
              subscription: r.waba_id ? 'subscribed' : 'pending',
              health: 'ok',
            },
          ]
        : [],
    )
  },

  async options(agencyId, id, optionSource): Promise<ConnectionOption[]> {
    // Two declared option sources. An unknown source yields nothing rather than
    // guessing (Law 3) — which is also what keeps the Builder generic: it passes
    // the catalog's declared `optionSource` through and renders {id,label}.
    if (optionSource === 'phone_numbers') {
      const sources = await whatsappProvider.listSources(agencyId, id)
      return sources.map((s) => ({ id: s.id, label: s.label }))
    }
    /**
     * The ready-made messages an automation may send.
     *
     * APPROVED ONLY, filtered here rather than in the Builder. An automation
     * fires with nobody watching, so offering a pending or rejected template
     * would be offering a configuration that cannot ever send — and the customer
     * would only discover it from a failed job. The existing template list
     * surface (settings) still shows every status, because a person looking at it
     * needs to see what is waiting and what was refused.
     *
     * Archived templates are excluded by `listTemplates`' own default.
     */
    if (optionSource === 'whatsapp_templates') {
      const { listTemplates } = await import('@/db/whatsappTemplates')
      const templates = await listTemplates(agencyId)
      return templates
        .filter((t) => t.status === 'approved')
        .map((t) => ({ id: String(t.id), label: t.displayTitle }))
    }
    return []
  },
}
