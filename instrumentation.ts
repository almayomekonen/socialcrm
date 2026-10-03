export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { assertMigrationsUpToDate } = await import('@/lib/startup/checkMigrations')
  await assertMigrationsUpToDate()

  // ChatGPT / MCP. A no-op unless MCP_ENABLED is exactly '1'; fatal in
  // production when MCP is on but its auth configuration is unsafe.
  const { assertMcpAuthEnv } = await import('@/lib/startup/checkMcpAuthEnv')
  assertMcpAuthEnv()
}
