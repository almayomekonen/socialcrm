import type { AnyActionExecutor } from './types'
import { emailExecutor } from './email'
import { taskExecutor } from './task'
import { whatsappExecutor } from './whatsapp'
import { quoteExecutor } from './quote'

/**
 * The executor registry — the only file that knows which actions can actually
 * run. Same shape as the connector registry (B4): a static list plus a lookup,
 * so adding an action is one entry here, one catalog row, and one module.
 *
 * A catalog action with no executor is not a crash and not a silent pass: the
 * worker skips with `action_unavailable`, which already carries user-visible
 * Hebrew copy. Declared-but-unexecutable fails CLOSED.
 */
const EXECUTORS: readonly AnyActionExecutor[] = [
  emailExecutor as unknown as AnyActionExecutor,
  taskExecutor as unknown as AnyActionExecutor,
  whatsappExecutor as unknown as AnyActionExecutor,
  quoteExecutor as unknown as AnyActionExecutor,
]

export function executorFor(actionKey: string): AnyActionExecutor | null {
  return EXECUTORS.find((e) => e.actionKey === actionKey) ?? null
}

/**
 * Which subject fields an action's content may reference. The EXECUTOR is the
 * authority — an unregistered action can resolve nothing, so its content is
 * validated against the empty set rather than against email's.
 */
export function resolvableFieldsFor(actionKey: string): readonly string[] {
  return executorFor(actionKey)?.resolvableFields ?? []
}

/** Every action key that can execute today. CI pins this against the catalog. */
export function registeredActionKeys(): readonly string[] {
  return EXECUTORS.map((e) => e.actionKey)
}
