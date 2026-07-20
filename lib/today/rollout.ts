// Today brief v2 — gradual rollout gate. Follows the repo's env-allowlist canary
// convention (cf. lib/copilot/featureFlag.ts): global enable + per-agency
// allowlist + percentage cohort + a hard kill switch. The DECISION is pure and
// unit-tested; only the config LOADER reads env. Instant rollback: flip
// TODAY_BRIEF_V2_KILL (hard off) — and the page also falls back to legacy on any
// buildTodayBrief error (per-request, no redeploy). To make the toggle itself
// zero-redeploy, point loadRolloutConfig at a runtime store (Edge Config / a
// config row) later; the seam is this one function.

import { todayBriefV2Enabled } from './flag'

export type RolloutConfig = {
  enabled: boolean
  killSwitch: boolean
  allowlist: number[] | 'all'
  percentage: number // 0..100
}

function parseAllowlist(raw: string | undefined): number[] | 'all' {
  const v = (raw ?? '').trim()
  if (v.toLowerCase() === 'all') return 'all'
  if (!v) return []
  return v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n))
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.trunc(n)))
}

export function loadRolloutConfig(): RolloutConfig {
  return {
    enabled: todayBriefV2Enabled(),
    killSwitch: process.env.TODAY_BRIEF_V2_KILL === '1',
    allowlist: parseAllowlist(process.env.TODAY_BRIEF_V2_AGENCIES),
    percentage: clampPct(Number(process.env.TODAY_BRIEF_V2_PCT ?? '0')),
  }
}

// Deterministic 0..99 cohort from agencyId (FNV-1a). Stable → an agency never
// flickers between paths as the percentage grows; no Math.random.
export function stableBucket(agencyId: number): number {
  let h = 2166136261
  const s = String(agencyId)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % 100
}

/** Pure rollout decision. killSwitch and disabled both force OFF (fallback to legacy). */
export function rolloutDecision(config: RolloutConfig, agencyId: number | null | undefined): boolean {
  if (config.killSwitch || !config.enabled) return false
  if (typeof agencyId !== 'number') return false
  if (config.allowlist === 'all') return true
  if (config.allowlist.includes(agencyId)) return true
  if (config.percentage <= 0) return false
  if (config.percentage >= 100) return true
  return stableBucket(agencyId) < config.percentage
}

export function isTodayBriefEnabledForAgency(agencyId: number | null | undefined): boolean {
  return rolloutDecision(loadRolloutConfig(), agencyId)
}
