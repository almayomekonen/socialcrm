/**
 * `vi.mock` factories of the leak gate (leakGate.test.tsx) for the
 * questionnaire builder (Phase E5c). While a questionnaire surface is being
 * built (`questionnaireEnv.active`), the modules it shares with earlier
 * surfaces answer from the questionnaire fixtures; otherwise exactly as before.
 * The `vi.mock` calls stay in the test file.
 */

async function env() {
  return (await import('./questionnaireEnv')).questionnaireEnv
}

/** `@/lib/requireUser`: the earlier surfaces' session user; the Builder's product-access check from the questionnaire fixtures while active. */
export async function requireUserModule() {
  const { vi } = await import('vitest')
  const actual = await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')
  const fixture = await (await import('./questionnaireMocks')).requireUserModule()
  const e = await env()
  return {
    ...actual,
    requireAgencyUser: async () => (e.active ? fixture.requireAgencyUser() : (await import('./surfaces')).FIXTURE_USER),
    requireProductAccess: async () => (e.active ? fixture.requireProductAccess() : actual.requireProductAccess()),
  }
}

/** `@/lib/flags/questionnaireBuilderFlags`: the questionnaire fixtures' rollout / Flow flags while active, the admin fixtures' (E5a) otherwise. */
export async function builderFlagsModule() {
  const admin = await (await import('./adminMocks')).builderFlagsModule()
  const fixture = await (await import('./questionnaireMocks')).builderFlagsModule()
  const e = await env()
  return {
    ...admin,
    canUseQuestionnaireBuilder: () => (e.active ? fixture.canUseQuestionnaireBuilder() : admin.canUseQuestionnaireBuilder()),
    canUseQuestionnaireFlowEditor: (id: number) => (e.active ? fixture.canUseQuestionnaireFlowEditor() : admin.canUseQuestionnaireFlowEditor(id)),
  }
}

/** `@/lib/flags/whatsappQuestionnaireFlags`: natural answers from the questionnaire fixtures while active, the real (env-driven) flags otherwise. */
export async function naturalAnswersFlagsModule() {
  const { vi } = await import('vitest')
  const real = await vi.importActual<typeof import('@/lib/flags/whatsappQuestionnaireFlags')>('@/lib/flags/whatsappQuestionnaireFlags')
  const e = await env()
  return { ...real, canUseQuestionnaireNaturalAnswers: (id: number) => (e.active ? e.allowAll : real.canUseQuestionnaireNaturalAnswers(id)) }
}

/** `…/questionnaire/builder/service`: the Builder state from the questionnaire fixtures while active, the real module otherwise. */
export async function serviceModule() {
  const { vi } = await import('vitest')
  const real = await vi.importActual<typeof import('@/lib/inbox/autoresponse/questionnaire/builder/service')>('@/lib/inbox/autoresponse/questionnaire/builder/service')
  const fixture = (await import('./questionnaireMocks')).serviceModule()
  const e = await env()
  return { ...real, getBuilderState: (...a: Parameters<typeof real.getBuilderState>) => (e.active ? fixture.getBuilderState() : real.getBuilderState(...a)) } as typeof real
}
