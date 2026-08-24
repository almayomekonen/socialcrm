import { getAiEnv } from './env'
import { hasAnyProviderConfigured, isAgencyAllowlisted, isAiEnabled } from './flags'
import { getProviderChain, type ResolvedModel } from './providers'
import { getTaskConfig, type TaskConfig } from './tasks'
import type { AiFailureReason, ModelRole, TaskKind } from './types'
import { evaluateShadowGate } from '@/lib/entitlements'
import { resolveAiAccess } from './access'
import type { CopilotModeId } from './copilotModes'
import { getDailySpend } from './router/spend'

/**
 * The AI admission gate — everything that decides whether a run may start, and
 * with which model, in one place.
 *
 * This was `runStructured`'s opening block. It lives here so a second execution
 * path can never grow a second copy of it: the security-sensitive part of this
 * sequence is not any individual check but the ORDER they run in, and an order
 * duplicated by hand is an order that drifts.
 *
 * The order is load-bearing in four ways, each of which is a real production
 * property rather than a style preference:
 *
 *   · The shadow gate runs BEFORE the forbidden return, so a DENIED agency is
 *     still observed. Moving it below the denial would leave every other test
 *     green while blinding the telemetry that exists to find exactly those
 *     divergences.
 *   · The allowlist runs BEFORE entitlement, so a non-allowlisted agency is
 *     `forbidden` and its subscription is never read.
 *   · `bypassAllowlist` skips ENTITLEMENT ONLY. Internal callers (health check,
 *     offline scripts) carry no subscription to evaluate, but they are still
 *     subject to the provider check and the daily USD cap.
 *   · Entitlement FAILS OPEN inside `resolveAiAccess`. A transient DB failure
 *     must never tell a paying customer "subscription required". The gate adds
 *     no denial of its own on top of that.
 *
 * Admission failures deliberately carry no `latencyMs`. Nothing was attempted,
 * so there is no latency to report; only `all-providers-failed` — which is the
 * router's business, not the gate's — measures anything.
 *
 * This module decides admission for an AGENCY. It knows nothing about roles,
 * permissions or users: that is a different boundary (see lib/agent/scope.ts),
 * and merging the two would put user-level authorization behind an env flag.
 */

export type AiAdmissionInput = {
  kind: TaskKind
  agencyId?: number | null
  bypassAllowlist?: boolean
  roleOverride?: ModelRole
  copilotModeId?: CopilotModeId
}

export type AiAdmission =
  | { ok: true; cfg: TaskConfig; effectiveRole: ModelRole; chain: ResolvedModel[] }
  | { ok: false; reason: AiFailureReason }

export async function admitAiRun(input: AiAdmissionInput): Promise<AiAdmission> {
  const env = getAiEnv()

  if (!isAiEnabled()) return { ok: false, reason: 'disabled' }

  const allowlisted = isAgencyAllowlisted(input.agencyId)
  const oldAllowed = input.bypassAllowlist === true || allowlisted

  await evaluateShadowGate({
    surface: input.bypassAllowlist === true ? 'router.runStructured.bypass' : 'router.runStructured',
    agencyId: input.agencyId ?? null,
    oldAllowed,
    copilotModeId: input.copilotModeId ?? null,
    taskKind: input.kind,
    role: input.roleOverride ?? null,
    bypassAllowlist: input.bypassAllowlist ?? false,
  })

  if (!oldAllowed) return { ok: false, reason: 'forbidden' }

  // Product-access entitlement (Phase 2). Runs only for real agency traffic that
  // already passed the allowlist/rollout gate above. Internal bypass callers
  // (health check, offline scripts) and agency-less calls skip it — they carry
  // no subscription to evaluate. This is the server-authoritative revenue/access
  // boundary; UI state is not authorization. resolveAiAccess FAILS OPEN on any
  // read error, so a transient DB failure never denies a paying customer.
  if (input.bypassAllowlist !== true && input.agencyId) {
    const access = await resolveAiAccess(input.agencyId)
    if (access.allowed === false) return { ok: false, reason: access.reason }
  }

  if (!hasAnyProviderConfigured()) return { ok: false, reason: 'no-providers' }
  if (input.agencyId && getDailySpend(input.agencyId) >= env.dailyUsdCap) {
    return { ok: false, reason: 'over-quota' }
  }

  const cfg = getTaskConfig(input.kind)
  const effectiveRole = input.roleOverride ?? cfg.role
  const chain = getProviderChain(effectiveRole, input.kind)
  if (chain.length === 0) return { ok: false, reason: 'no-providers' }

  return { ok: true, cfg, effectiveRole, chain }
}
