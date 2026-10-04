import { mcpResource } from './config'

/**
 * redirect_uri: EXACT string membership in the list the client registered (its
 * CIMD document). No parsing, no normalisation — case, trailing slash, port,
 * query, fragment and encoding differences are all mismatches (OAuth 2.1 §2.3.1).
 */
export function redirectUriAllowed(requested: string, registered: readonly string[]): boolean {
  if (typeof requested !== 'string' || requested === '') return false
  return registered.some((r) => r === requested)
}

// scheme://authority/path with no userinfo, query, fragment, backslash or whitespace.
const RESOURCE_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#@\\\s]+)(\/[^?#\\\s]*)$/

/**
 * RFC 8707 resource indicator: only the canonical MCP URI.
 *
 * Deliberately NOT URL-parsed, because WHATWG parsing would silently normalise
 * dot segments and default ports. The only tolerances are the ones the approved
 * plan names: case-insensitive scheme and host, and ONE trailing slash on the
 * path. Everything else must match character for character.
 */
export function isThisResource(raw: string): boolean {
  if (typeof raw !== 'string') return false
  const m = RESOURCE_RE.exec(raw)
  if (!m) return false
  const [, scheme, authority, path] = m
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  return `${scheme.toLowerCase()}://${authority.toLowerCase()}${trimmed}` === mcpResource()
}
