import type { ModelRole } from './types'
import type { IconNames } from '../Icon'

/**
 * Catalog of operational AI modes the rep can pick from in the Copilot composer.
 *
 * Strict separation of concerns:
 *   - The label / description / icon are user-facing operational language.
 *   - The `role` maps to an internal `ModelRole`. Only the router knows which
 *     provider/model that resolves to. Per `ai-safety-boundaries.md` §7,
 *     model IDs and provider names never appear in the UI.
 *   - `requiredTier` is a forward-compatibility hook for future plan gating.
 *     No tier check fires today; the field is the contract a future
 *     `userTier()` helper will read.
 *
 * Adding a new mode is one entry here plus (if needed) a new `ModelRole`.
 * Wiring through `runStructured(roleOverride)` is automatic.
 */
export type CopilotModeId = 'fast' | 'smart' | 'advanced'

export type CopilotMode = {
  id: CopilotModeId
  label: string
  description: string
  role: ModelRole
  icon: IconNames
  requiredTier?: 'pro'
}

export const DEFAULT_COPILOT_MODE_ID: CopilotModeId = 'smart'

export const COPILOT_MODES: readonly CopilotMode[] = [
  {
    id: 'fast',
    label: 'מהיר',
    description: 'תשובה מיידית למשימות קצרות',
    role: 'volume',
    icon: 'bolt',
  },
  {
    id: 'smart',
    label: 'חכם',
    description: 'התשובה הטובה ביותר לרוב המשימות',
    role: 'primary',
    icon: 'brain',
    requiredTier: 'pro',
  },
  {
    id: 'advanced',
    label: 'מתקדם',
    description: 'ניתוח מעמיק למצבים מורכבים',
    role: 'heavy',
    icon: 'gem',
    requiredTier: 'pro',
  },
] as const

export function isCopilotModeId(value: unknown): value is CopilotModeId {
  return value === 'fast' || value === 'smart' || value === 'advanced'
}

export function getCopilotMode(id: CopilotModeId): CopilotMode {
  const found = COPILOT_MODES.find((m) => m.id === id)
  if (!found) return COPILOT_MODES.find((m) => m.id === DEFAULT_COPILOT_MODE_ID)!
  return found
}

export function resolveCopilotModeRole(raw: unknown): ModelRole {
  return getCopilotMode(isCopilotModeId(raw) ? raw : DEFAULT_COPILOT_MODE_ID).role
}
