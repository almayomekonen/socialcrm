/**
 * What an OAuth error log may contain: the error's class and machine code
 * (e.g. a Postgres SQLSTATE or ECONNREFUSED) — never its message, which can
 * carry SQL text or library-generated detail. Same policy as lib/mcp/runTool.
 */
export function errorClass(e: unknown): { error: string; code?: string } {
  const name = (e as Error)?.name
  const code = (e as { code?: unknown })?.code
  return { error: typeof name === 'string' ? name : 'unknown', ...(typeof code === 'string' ? { code } : {}) }
}
