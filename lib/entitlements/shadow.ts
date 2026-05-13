import { getEntitlements } from './getEntitlements'
import { isPro, canUseAiMode } from './predicates'
import type { AiModeId, Entitlements } from './types'

/**
 * Phase B — shadow telemetry.
 *
 * Goal: observe what the NEW entitlement system would have decided, alongside
 * what the CURRENT allowlist-based gate actually decided, on every real AI
 * dispatch — without enforcing the new decision.
 *
 * Design contract:
 *   - This module NEVER affects control flow. It awaits its own work inside a
 *     try/catch and returns void. A bug in `getEntitlements` cannot block an
 *     AI call.
 *   - It NEVER reproduces gating logic. The shadow decision comes from
 *     `isPro` / `canUseAiMode` (predicates) which read the snapshot returned
 *     by `getEntitlements`. No allowlist re-check, no plan re-read.
 *   - It NEVER spams. The default log policy is "divergences + errors only".
 *     Agreements are silent. Set `AI_SHADOW_TELEMETRY=verbose` to also emit
 *     agreement entries during a one-off audit; default mode is concise.
 *   - It NEVER leaks doctrine surface. The log payload contains plan,
 *     planSource, quota counters, decision flags. No provider names, no
 *     model IDs, no message content.
 *
 * Output shape (all logged via console.info as `[ai.shadow] <json>`):
 *
 *   shadow.divergence   — old !== new. The signal we are looking for.
 *   shadow.agree        — old === new. Silent unless verbose mode.
 *   shadow.error        — getEntitlements threw. Indicates a bug in the new
 *                         system that must be fixed before Phase C.
 *
 * Disable with `AI_SHADOW_TELEMETRY=off` (kill switch for emergencies).
 */

export type ShadowSurface =
  | 'router.runStructured'
  | 'router.runStructured.bypass'

export type ShadowGateInput = {
  surface: ShadowSurface
  agencyId: number | null
  /**
   * What the CURRENT production gate decided for this call. The router
   * computes this as `bypassAllowlist || isAgencyAllowlisted(agencyId)`.
   * Phase B does not re-implement that — the router passes it in.
   */
  oldAllowed: boolean
  /**
   * The Copilot mode the user picked, when known. Only Copilot dispatchers
   * know this. Cached predefined actions and internal/health calls leave it
   * null; the shadow eval then compares at the plan level (isPro) rather
   * than the per-mode level (canUseAiMode).
   */
  copilotModeId?: AiModeId | null
  taskKind?: string | null
  role?: string | null
  bypassAllowlist?: boolean
}

function isOff(): boolean {
  return process.env.AI_SHADOW_TELEMETRY === 'off'
}

function isVerbose(): boolean {
  return process.env.AI_SHADOW_TELEMETRY === 'verbose'
}

function emit(payload: Record<string, unknown>): void {
  try {
    console.info('[ai.shadow]', JSON.stringify(payload))
  } catch {
    // swallow
  }
}

function quotaSnapshot(e: Entitlements, mode: AiModeId | null | undefined) {
  if (!mode) return null
  const access = e.ai.modes[mode]
  if (!access) return null
  return {
    allowed: access.allowed,
    used: access.quota.used,
    limit: access.quota.limit,
    remaining: access.quota.remaining,
  }
}

/**
 * Run the shadow evaluation. Awaited by the router but wrapped so it cannot
 * throw or alter control flow.
 *
 * Skipped silently when:
 *   - `AI_SHADOW_TELEMETRY=off`
 *   - `agencyId` is null (no plan to read; production gate denies anyway)
 */
export async function evaluateShadowGate(input: ShadowGateInput): Promise<void> {
  if (isOff()) return
  if (input.agencyId == null) return

  let entitlements: Entitlements
  try {
    entitlements = await getEntitlements(input.agencyId)
  } catch (err) {
    emit({
      kind: 'shadow.error',
      surface: input.surface,
      agencyId: input.agencyId,
      taskKind: input.taskKind ?? null,
      message: ((err as Error)?.message ?? 'unknown').slice(0, 200),
    })
    return
  }

  const newAllowed = input.copilotModeId
    ? canUseAiMode(entitlements, input.copilotModeId)
    : isPro(entitlements)

  const agreed = input.oldAllowed === newAllowed

  if (agreed && !isVerbose()) return

  emit({
    kind: agreed ? 'shadow.agree' : 'shadow.divergence',
    surface: input.surface,
    agencyId: input.agencyId,
    taskKind: input.taskKind ?? null,
    role: input.role ?? null,
    mode: input.copilotModeId ?? null,
    bypassAllowlist: input.bypassAllowlist ?? false,
    decision: { old: input.oldAllowed, new: newAllowed },
    plan: entitlements.plan,
    planSource: entitlements.planSource,
    quota: quotaSnapshot(entitlements, input.copilotModeId ?? null),
    monthlyAiTotal: entitlements.ai.totalUsedThisMonth,
    windowStart: entitlements.ai.windowStart,
  })
}
