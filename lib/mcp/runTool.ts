import 'server-only'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { publicOrigin, type McpScopeName } from '@/lib/oauth/server/config'
import type { McpAuthResult } from './auth'
import type { AuditIdentity, McpPrincipal } from './scope'
import { McpToolError, toolError, toolOk } from './errors'
import { bearerChallenge, wwwAuthenticateMeta } from './wwwAuthenticate'
import { checkRateLimit } from './rateLimit'
import { writeAudit } from './audit'

/**
 * Every MCP tool runs through here, in a fixed order:
 *
 *   1. an authenticated principal (else the matching structured error)
 *   2. the tool's required scope
 *   3. rate limits
 *   4. the tool itself
 *   5. one audit row
 *
 * AUDIT FAILURE SEMANTICS (Phase A reads): FAIL CLOSED on success — if the
 * audit row for a successful read cannot be written, the data is withheld and
 * server_error is returned, so no read is ever served unaudited. Error outcomes
 * are returned even if their audit write fails (nothing is disclosed); the
 * failure is logged.
 *
 * Logs carry the request id, tool name, outcome and error class only — never
 * an exception message, which could echo user-supplied text or SQL.
 */
export type RunToolCtx = {
  auth: McpAuthResult
  requestId: string
  tool: string
  scope: McpScopeName
  params: Record<string, unknown>
  target?: { type: 'lead' | 'conversation'; id: number }
  includeMessages?: boolean
}

const errorClass = (e: unknown) => ({
  error: (e as Error)?.name ?? 'unknown',
  code: typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : undefined,
})

export async function runTool<T extends Record<string, unknown>>(
  ctx: RunToolCtx,
  fn: (p: McpPrincipal) => Promise<{ data: T; resultCount?: number }>,
): Promise<CallToolResult> {
  const started = Date.now()
  const audit = async (who: AuditIdentity, outcome: string, resultCount?: number) =>
    writeAudit({
      requestId: who.requestId,
      agencyId: who.agencyId,
      userId: who.userId,
      grantId: who.grantId,
      clientId: who.clientId,
      tool: ctx.tool,
      targetType: ctx.target?.type,
      targetId: ctx.target?.id,
      params: ctx.params,
      outcome,
      resultCount,
      durationMs: Date.now() - started,
    })
  const auditBestEffort = async (who: AuditIdentity, outcome: string) => {
    await audit(who, outcome).catch((e) =>
      console.error('[mcp/audit] write failed', { requestId: who.requestId, tool: ctx.tool, outcome, ...errorClass(e) }),
    )
  }
  const refuse = async (who: AuditIdentity, e: McpToolError) => {
    await auditBestEffort(who, e.code)
    return toolError(e, who.requestId)
  }

  // ── 1. Principal
  const a = ctx.auth
  if (!('principal' in a)) {
    // Authenticated but not allowed to proceed: audited refusals.
    if ('reason' in a) {
      return refuse(
        a.identity,
        new McpToolError('product_access_required', { reason: a.reason, url: `${publicOrigin()}/settings/update_payment` }),
      )
    }
    if ('identity' in a) return refuse(a.identity, new McpToolError('feature_not_enabled'))
    // No identity: nothing to audit.
    if (a.kind === 'disabled') return toolError(new McpToolError('feature_not_enabled'), ctx.requestId)
    const challenge = bearerChallenge({
      error: 'invalid_token',
      description: 'Connect SocialCRM to use this tool',
      scope: ctx.scope,
    })
    return toolError(new McpToolError('insufficient_scope', undefined, wwwAuthenticateMeta(challenge)), ctx.requestId)
  }
  const p = a.principal

  // ── 2. Scope
  if (!p.scopes.includes(ctx.scope)) {
    const challenge = bearerChallenge({
      error: 'insufficient_scope',
      description: `This tool needs ${ctx.scope}`,
      scope: Array.from(new Set([...p.scopes, ctx.scope])).join(' '),
    })
    return refuse(p, new McpToolError('insufficient_scope', { requiredScope: ctx.scope }, wwwAuthenticateMeta(challenge)))
  }

  // ── 3. Rate limits
  const limit = await checkRateLimit(p, { includeMessages: ctx.includeMessages })
  if ('retryAfterSeconds' in limit)
    return refuse(p, new McpToolError('rate_limited', { retryAfterSeconds: limit.retryAfterSeconds }))

  // ── 4. Tool
  let result: { data: T; resultCount?: number }
  try {
    result = await fn(p)
  } catch (e) {
    if (e instanceof McpToolError) return refuse(p, e)
    console.error('[mcp] tool failed', { requestId: p.requestId, tool: ctx.tool, ...errorClass(e) })
    return refuse(p, new McpToolError('server_error'))
  }

  // ── 5. Audit — fail closed for a successful read.
  try {
    await audit(p, 'ok', result.resultCount)
  } catch (e) {
    console.error('[mcp/audit] write failed; result withheld', { requestId: p.requestId, tool: ctx.tool, ...errorClass(e) })
    return toolError(new McpToolError('server_error'), p.requestId)
  }
  return toolOk(result.data)
}
