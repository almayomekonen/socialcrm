/**
 * `vi.mock` factories of the leak gate (leakGate.test.tsx) for the automations
 * screens (Phase E5b). While an automations surface is being built
 * (`automationsEnv.active`), the modules it shares with earlier surfaces answer
 * from the automations fixtures; otherwise exactly as before (the real flags,
 * the leads banners' delivery facts). The `vi.mock` calls stay in the test file.
 */

async function env() {
  return (await import('./automationsEnv')).automationsEnv
}

/** `@/lib/automations/flags`: the fixtures' allowlist / pilot / send mode while active, the real (env-driven) flags otherwise. */
export async function flagsModule() {
  const { vi } = await import('vitest')
  const real = await vi.importActual<typeof import('@/lib/automations/flags')>('@/lib/automations/flags')
  const fixture = await (await import('./automationsMocks')).flagsModule()
  const e = await env()
  return {
    ...real,
    isAutomationsAgencyAllowlisted: (id: number) => (e.active ? fixture.isAutomationsAgencyAllowlisted() : real.isAutomationsAgencyAllowlisted(id)),
    isAutomationsPilotDashboardEnabled: () => (e.active ? fixture.isAutomationsPilotDashboardEnabled() : real.isAutomationsPilotDashboardEnabled()),
    getAutomationsSendMode: () => (e.active ? fixture.getAutomationsSendMode() : real.getAutomationsSendMode()),
    getAutomationsFrom: () => (e.active ? fixture.getAutomationsFrom() : real.getAutomationsFrom()),
  }
}

/** `@/db/automations/connectionDelivery`: the connections' delivery facts while active, the leads banners' intake facts otherwise. */
export async function connectionDeliveryDbModule() {
  const { leadsEnv } = await import('./leadsEnv')
  const fixture = (await import('./automationsMocks')).connectionDeliveryDbModule()
  const e = await env()
  return { deliveryFacts: async () => (e.active ? fixture.deliveryFacts() : leadsEnv.intakeFacts) }
}
