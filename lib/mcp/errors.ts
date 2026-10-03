import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * Structured MCP tool errors. Messages are fixed English strings written for
 * the model; nothing from an exception, the database or the caller ever
 * reaches a result. not_found deliberately covers "not permitted" too.
 */
export const MCP_ERROR_CODES = [
  'invalid_input',
  'not_found',
  'insufficient_scope',
  'product_access_required',
  'feature_not_enabled',
  'rate_limited',
  'server_error',
] as const
export type McpErrorCode = (typeof MCP_ERROR_CODES)[number]

const MESSAGES: Record<McpErrorCode, string> = {
  invalid_input: 'The tool input is invalid.',
  not_found: 'No matching record was found that this user is allowed to see.',
  insufficient_scope: 'This connection is not authorized for this tool. Reconnect SocialCRM and approve the requested access.',
  product_access_required:
    "The user's SocialCRM account does not currently have product access. Ask them to open SocialCRM to activate or renew it.",
  feature_not_enabled: 'The ChatGPT connection is not enabled for this SocialCRM account.',
  rate_limited: 'Too many requests. Wait before trying again.',
  server_error: 'SocialCRM could not complete this request. Try again later.',
}

export class McpToolError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    /** Safe, server-built extra fields only (e.g. retryAfterSeconds, requiredScope). */
    public readonly extra?: Record<string, unknown>,
    /** Result-level _meta, e.g. the mcp/www_authenticate challenge. */
    public readonly meta?: Record<string, unknown>,
  ) {
    super(code)
    this.name = 'McpToolError'
  }
}

export function toolOk(structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(structured) }], structuredContent: structured }
}

export function toolError(e: McpToolError, requestId: string): CallToolResult {
  const structured = { error: { code: e.code, message: MESSAGES[e.code], requestId, ...(e.extra ?? {}) } }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
    ...(e.meta ? { _meta: e.meta } : {}),
  }
}
