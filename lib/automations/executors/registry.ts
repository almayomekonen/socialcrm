import type { ActionExecutor } from './types'
import { emailExecutor } from './email'

/**
 * The executor registry — the only file that knows which actions can actually
 * run. Same shape as the connector registry (B4): a static list plus a lookup,
 * so adding an action is one entry here, one catalog row, and one module.
 *
 * A catalog action with no executor is not a crash and not a silent pass: the
 * worker skips with `action_unavailable`, which already carries user-visible
 * Hebrew copy. Declared-but-unexecutable fails CLOSED.
 */
const EXECUTORS: readonly ActionExecutor<never>[] = [emailExecutor as ActionExecutor<never>]

export function executorFor(actionKey: string): ActionExecutor<never> | null {
  return EXECUTORS.find((e) => e.actionKey === actionKey) ?? null
}

/** Every action key that can execute today. CI pins this against the catalog. */
export function registeredActionKeys(): readonly string[] {
  return EXECUTORS.map((e) => e.actionKey)
}
