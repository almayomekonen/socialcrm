import 'server-only'
import { listActiveGrantsForUser } from './grants'
import { isMcpScope, SCOPE_LABELS_HE } from './config'
import { auditSourceFor } from '@/lib/mcp/audit'
import { BUSINESS_TZ } from '@/lib/today/constants'

/**
 * What Settings shows about the signed-in user's AI connections — built on the
 * server from that user's own ACTIVE grants (never another user's, never
 * agency-wide). Contains no token, code, hash or client metadata URL; the grant
 * id is the only handle, and the disconnect action re-checks it belongs to the
 * session user before revoking anything.
 *
 * Dates are formatted here, in the business timezone, so the client component
 * renders strings and server/browser hydration always agree.
 */
export type AiConnectionView = {
  grantId: number
  /** 'Claude' | 'ChatGPT' for known hosts; otherwise the validated client name. */
  clientLabel: string
  scopeLabels: string[]
  connectedOn: string
  lastUsedOn: string | null
}

const KNOWN_LABEL: Record<string, string> = { claude: 'Claude', chatgpt: 'ChatGPT' }

const dateFmt = new Intl.DateTimeFormat('he-IL', { timeZone: BUSINESS_TZ, day: 'numeric', month: 'numeric', year: 'numeric' })
const fmt = (d: Date | null) => (d ? dateFmt.format(d) : null)

export async function listAiConnections(userId: number, agencyId: number): Promise<AiConnectionView[]> {
  const grants = (await listActiveGrantsForUser(userId)).filter((g) => g.agencyId === agencyId)
  return grants.map((g) => ({
    grantId: g.id,
    clientLabel: KNOWN_LABEL[auditSourceFor(g.clientId)] ?? (g.clientName?.trim() || 'אפליקציית AI'),
    scopeLabels: g.scopes.filter(isMcpScope).map((s) => SCOPE_LABELS_HE[s]),
    connectedOn: fmt(g.createdAt) ?? '',
    lastUsedOn: fmt(g.lastUsedAt),
  }))
}
