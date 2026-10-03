import { protectedResourceMetadataUrl, MCP_READ_SCOPES } from '@/lib/oauth/server/config'

/**
 * RFC 6750 / RFC 9728 bearer challenges for the MCP resource.
 *
 * Used as the HTTP WWW-Authenticate header (Task 12 route) and inside tool
 * results as _meta["mcp/www_authenticate"] (the OpenAI Apps / MCP shape that
 * triggers account linking). Descriptions are fixed server strings; quotes,
 * backslashes and control characters are stripped so a value can never break
 * out of its quoted parameter.
 */
const clean = (s: string) => s.replace(/["\\\u0000-\u001f\u007f]/g, '')

export function bearerChallenge(o: {
  error?: 'invalid_token' | 'insufficient_scope'
  description: string
  scope?: string
}): string {
  const parts = [
    `resource_metadata="${clean(protectedResourceMetadataUrl())}"`,
    `scope="${clean(o.scope ?? MCP_READ_SCOPES.join(' '))}"`,
  ]
  if (o.error) parts.push(`error="${o.error}"`)
  parts.push(`error_description="${clean(o.description)}"`)
  return `Bearer ${parts.join(', ')}`
}

export function wwwAuthenticateMeta(challenge: string): Record<string, unknown> {
  return { 'mcp/www_authenticate': [challenge] }
}
