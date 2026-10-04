/**
 * The single source of every URL the OAuth server and the MCP resource publish.
 *
 * Issuer, resource (the access token's `aud`), the metadata URLs and the `iss`
 * appended to authorization responses are ALL derived here from one env value,
 * MCP_PUBLIC_ORIGIN, so they cannot disagree (RFC 8707 / RFC 9207). Read per
 * call, never cached at module scope.
 */

export const MCP_READ_SCOPES = ['crm.leads.read', 'crm.conversations.read'] as const
export type McpScopeName = (typeof MCP_READ_SCOPES)[number]

/** Consent-screen wording, one line per scope. Product terminology: לידים. */
export const SCOPE_LABELS_HE: Record<McpScopeName, string> = {
  'crm.leads.read': 'צפייה בלידים שלך, במעקבים ובסיכום היומי',
  'crm.conversations.read': 'צפייה בסיכומי שיחות WhatsApp עם הלידים שלך, ובהודעות עצמן לפי בקשה',
}

export function isMcpScope(s: string): s is McpScopeName {
  return (MCP_READ_SCOPES as readonly string[]).includes(s)
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1'
}

/**
 * The bare origin everything is built from. Throws on anything that is not a
 * plain origin: https always, except http on loopback outside production (local
 * development behind no tunnel).
 */
export function publicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.MCP_PUBLIC_ORIGIN ?? ''
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error('MCP_PUBLIC_ORIGIN is missing or not a URL')
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    throw new Error('MCP_PUBLIC_ORIGIN must be a bare origin (no path, query, fragment or credentials)')
  }
  const devLoopback = u.protocol === 'http:' && isLoopback(u.hostname) && env.NODE_ENV !== 'production'
  if (u.protocol !== 'https:' && !devLoopback) throw new Error('MCP_PUBLIC_ORIGIN must use https')
  return `${u.protocol}//${u.host}`.toLowerCase()
}

export const issuer = (): string => publicOrigin()
export const mcpResource = (): string => `${publicOrigin()}/api/mcp`
export const protectedResourceMetadataUrl = (): string => `${publicOrigin()}/.well-known/oauth-protected-resource/api/mcp`
export const leadUrl = (leadId: number): string => `${publicOrigin()}/clients/${leadId}`
/** The inbox deep link the app itself uses (`/inbox?conversation=<id>`), from a trusted internal id only. */
export const conversationUrl = (conversationId: number): string =>
  `${publicOrigin()}/inbox?conversation=${encodeURIComponent(String(Math.trunc(conversationId)))}`
