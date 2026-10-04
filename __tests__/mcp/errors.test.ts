import { describe, it, expect } from 'vitest'
import { bearerChallenge, wwwAuthenticateMeta } from '@/lib/mcp/wwwAuthenticate'
import { McpToolError, toolError, toolOk, MCP_ERROR_CODES } from '@/lib/mcp/errors'

const PRM = 'https://crm.test/.well-known/oauth-protected-resource/api/mcp'

describe('bearerChallenge', () => {
  it('invalid_token: resource metadata, default scopes, error and description', () => {
    expect(bearerChallenge({ error: 'invalid_token', description: 'Missing or expired access token' })).toBe(
      `Bearer resource_metadata="${PRM}", scope="crm.leads.read crm.conversations.read", error="invalid_token", error_description="Missing or expired access token"`,
    )
  })

  it('insufficient_scope names the required scope', () => {
    expect(bearerChallenge({ error: 'insufficient_scope', description: 'needs more', scope: 'crm.conversations.read' })).toBe(
      `Bearer resource_metadata="${PRM}", scope="crm.conversations.read", error="insufficient_scope", error_description="needs more"`,
    )
  })

  it('no error parameter when only signalling that auth is required', () => {
    expect(bearerChallenge({ description: 'Authentication required' })).toBe(
      `Bearer resource_metadata="${PRM}", scope="crm.leads.read crm.conversations.read", error_description="Authentication required"`,
    )
  })

  it('cannot be broken by quotes, backslashes or control characters', () => {
    const c = bearerChallenge({ error: 'invalid_token', description: 'a"b\\c\r\nd', scope: 'x"y' })
    expect(c).not.toMatch(/[\r\n]/)
    expect(c).toContain('error_description="abcd"')
    expect(c).toContain('scope="xy"')
  })

  it('wraps a challenge as the OpenAI/MCP _meta shape', () => {
    expect(wwwAuthenticateMeta('Bearer x')).toEqual({ 'mcp/www_authenticate': ['Bearer x'] })
  })
})

describe('tool results', () => {
  it('ok results carry structuredContent and a JSON text mirror', () => {
    expect(toolOk({ a: 1 })).toEqual({ content: [{ type: 'text', text: '{"a":1}' }], structuredContent: { a: 1 } })
  })

  it('exactly the approved error codes exist', () => {
    expect([...MCP_ERROR_CODES].sort()).toEqual(
      [
        'feature_not_enabled',
        'insufficient_scope',
        'invalid_input',
        'not_found',
        'product_access_required',
        'rate_limited',
        'server_error',
      ].sort(),
    )
  })

  it('errors are isError with a fixed message, the code, the requestId and allowed extras only', () => {
    const r = toolError(new McpToolError('rate_limited', { retryAfterSeconds: 30 }), 'req-1')
    expect(r.isError).toBe(true)
    expect(r.structuredContent).toEqual({
      error: {
        code: 'rate_limited',
        message: 'Too many requests. Wait before trying again.',
        requestId: 'req-1',
        retryAfterSeconds: 30,
      },
    })
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual(r.structuredContent)
  })

  it('not_found never distinguishes absent from not permitted', () => {
    const r = toolError(new McpToolError('not_found'), 'req-2')
    expect((r.structuredContent as { error: { message: string } }).error.message).toBe(
      'No matching record was found that this user is allowed to see.',
    )
  })

  it('carries _meta only when given (e.g. the auth challenge)', () => {
    expect(toolError(new McpToolError('not_found'), 'r')._meta).toBeUndefined()
    const meta = wwwAuthenticateMeta('Bearer y')
    expect(toolError(new McpToolError('insufficient_scope', undefined, meta), 'r')._meta).toEqual(meta)
  })

  it('an Error message never reaches the result', () => {
    const e = new McpToolError('server_error')
    e.message = 'SELECT * FROM users WHERE secret'
    expect(JSON.stringify(toolError(e, 'r'))).not.toContain('SELECT')
  })
})
