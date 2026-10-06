import type { Roles } from '@/types/roles'
import type { Plan } from '@/lib/quota/types'
import type { McpScopeName } from '@/lib/oauth/server/config'

/**
 * Server-resolved authority for ONE MCP request — built by lib/mcp/auth.ts only
 * after every token, grant, account, rollout and product check passed. Tools
 * receive this and nothing else; it is never built from tool input, and it holds
 * no contact data, cookies, tokens or credential identifiers.
 */
export type McpPrincipal = {
  requestId: string
  userId: number
  agencyId: number
  role: Roles
  firstName: string
  /** Same visibility set the product uses: [] = admin (unrestricted), [0] = sees nothing. */
  gotPermIds: number[]
  plan: Plan
  grantId: number
  clientId: string
  scopes: McpScopeName[]
}

/** Enough identity to audit a call that was refused after authentication. */
export type AuditIdentity = {
  requestId: string
  userId: number
  agencyId: number
  grantId: number
  clientId: string
}
