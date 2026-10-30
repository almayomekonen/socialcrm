/**
 * `vi.mock` factories of the leak gate (leakGate.test.tsx) for the admin
 * settings pages (Phase E5). While an admin surface is being built
 * (`adminEnv.active`), the modules it shares with earlier surfaces answer from
 * the admin fixtures; otherwise exactly as before. The `vi.mock` calls (hoisted
 * per file) stay in the test file.
 */

export async function usersNTeamsDbModule() {
  const { adminEnv } = await import('./adminEnv')
  const base = await (await import('./leakGateMocks')).usersNTeamsDbModule()
  const admin = (await import('./adminMocks')).usersNTeamsDbModule()
  return { ...base, ...admin, getUsers: async () => (adminEnv.active ? admin.getUsers() : base.getUsers()) }
}

export async function tasksDbModule() {
  const { adminEnv } = await import('./adminEnv')
  const base = await (await import('./leakGateMocks')).tasksDbModule()
  const admin = (await import('./adminMocks')).tasksDbModule()
  return { ...base, getTaskTmpltById: admin.getTaskTmpltById, getTaskTmplts: async () => (adminEnv.active ? admin.getTaskTmplts() : base.getTaskTmplts()) }
}

export async function usersNteamsActionsModule() {
  return { ...(await import('./settingsMocks')).usersNteamsActionsModule(), ...(await import('./adminMocks')).usersNteamsActionsModule() }
}

export async function promosDbModule() {
  const { adminEnv } = await import('./adminEnv')
  const base = (await import('./dealsMocks')).promosDbModule()
  const admin = (await import('./adminMocks')).promosDbModule()
  return { ...base, getPromos: async () => (adminEnv.active ? admin.getPromos() : base.getPromos()) }
}

export async function autoResponseDbModule() {
  const { adminEnv } = await import('./adminEnv')
  const base = (await import('./inboxMocks')).autoResponseSettingsModule()
  const admin = (await import('./adminMocks')).autoResponseDbModule()
  return {
    getMasterEnabled: async (...a: unknown[]) => (adminEnv.active ? admin.getMasterEnabled() : base.getMasterEnabled(...(a as []))),
    getChannelSettings: async (...a: unknown[]) => (adminEnv.active ? admin.getChannelSettings() : base.getChannelSettings(...(a as []))),
  }
}

/** `@/config/db`: the auto-response agency-name read while an admin page is built, the earlier surfaces' answers otherwise. */
export async function configDbModule() {
  const base = (await (await import('./leakGateMocks')).configDbModuleWithSettings()).db as unknown as ((table: string) => unknown) & Record<string, unknown>
  const { adminEnv } = await import('./adminEnv')
  const admin = (await import('./adminMocks')).configDbModule().db
  return { db: new Proxy((table: string) => (adminEnv.active ? admin() : base(table)), { get: (_t, prop) => base[prop as string] }) }
}

/** `@/db/auth`: the admin fixture user while an admin page is built (the refusal varies the role). */
export async function authModule() {
  const { adminEnv } = await import('./adminEnv')
  const base = await (await import('./leakGateMocks')).authModule()
  return { ...base, getUser: async () => (adminEnv.active ? adminEnv.user : base.getUser()) }
}
