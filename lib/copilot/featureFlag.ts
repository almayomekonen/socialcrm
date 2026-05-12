import 'server-only'
import { getAiEnv } from '@/lib/ai/env'

/**
 * Server-only access check for the copilot side-panel.
 *
 * The copilot is gated independently from `AI_ENABLED` so we can roll the
 * panel out on its own schedule. When disabled (or the user's agency is not
 * in the allowlist) every copilot surface — navbar entry included — must
 * render nothing. → claude/ai/ai-copilot-principles.md (TBD).
 *
 * Intentionally minimal in Step 1: the shell ships behind a flag with no AI
 * calls. Provider/quota gating gets added when the first AI action wires up.
 */
export function isCopilotEnabledForUser(user: { agencyId?: number | null } | null | undefined): boolean {
  if (!user || typeof user.agencyId !== 'number') return false
  const env = getAiEnv()
  if (!env.copilotEnabled) return false
  if (env.copilotAgencyAllowlist === 'all') return true
  return env.copilotAgencyAllowlist.includes(user.agencyId)
}
