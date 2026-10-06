import { publicOrigin } from '@/lib/oauth/server/config'

/**
 * Boot-time validation of the ChatGPT / MCP authentication configuration.
 *
 * Only meaningful when MCP is ON (MCP_ENABLED exactly '1'). When it is off,
 * nothing MCP-related is reachable and nothing is required — a deployment that
 * has never heard of MCP must boot exactly as before.
 *
 * Issue messages name the variable and the problem, never the value: a secret
 * must not reach the logs because it was wrong.
 */

type Issue = { variable: string; problem: string; fatal: boolean }
export type McpEnvCheck = { status: 'ok' | 'warn' | 'fatal'; issues: Issue[] }

const MIN_SECRET_LENGTH = 32

/** Pure. */
export function checkMcpAuthEnv(env: NodeJS.ProcessEnv): McpEnvCheck {
  if (env.MCP_ENABLED !== '1') return { status: 'ok', issues: [] }

  const issues: Issue[] = []
  const secret = env.MCP_JWT_SECRET ?? ''

  if (secret.length < MIN_SECRET_LENGTH) {
    issues.push({ variable: 'MCP_JWT_SECRET', problem: `missing or shorter than ${MIN_SECRET_LENGTH} chars`, fatal: true })
  }
  // A shared key would let a web-session or mobile token be replayed as an MCP
  // token (or the reverse) the moment any one of them leaks.
  if (secret && (secret === env.JWT_SECRET || secret === env.MOBILE_JWT_SECRET)) {
    issues.push({ variable: 'MCP_JWT_SECRET', problem: 'must differ from JWT_SECRET and MOBILE_JWT_SECRET', fatal: true })
  }

  try {
    publicOrigin(env)
  } catch (e) {
    issues.push({ variable: 'MCP_PUBLIC_ORIGIN', problem: (e as Error).message, fatal: true })
  }

  if (!env.MCP_AGENCY_ALLOWLIST?.trim()) {
    issues.push({ variable: 'MCP_AGENCY_ALLOWLIST', problem: 'empty — MCP is on but no agency can use it', fatal: false })
  }

  if (issues.some((i) => i.fatal)) return { status: 'fatal', issues }
  return { status: issues.length > 0 ? 'warn' : 'ok', issues }
}

/**
 * Boot gate. Throws in production when MCP is enabled but its authentication
 * cannot work safely; logs otherwise. Development is never fatal, so a
 * contributor who does not work on MCP never has to configure it.
 */
export function assertMcpAuthEnv(env: NodeJS.ProcessEnv = process.env): void {
  const { status, issues } = checkMcpAuthEnv(env)
  if (status === 'ok') return

  for (const issue of issues) {
    const line = `[startup/mcp-auth] ${issue.variable}: ${issue.problem}`
    if (issue.fatal) console.error(line)
    else console.warn(line)
  }

  if (status === 'fatal' && env.NODE_ENV === 'production') {
    throw new Error('[startup/mcp-auth] MCP authentication is misconfigured — see the errors above')
  }
}
