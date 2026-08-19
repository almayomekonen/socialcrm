/**
 * Mobile list selection + action-sheet context.
 *
 * IDs only — never whole row objects. `selecting` is derived from `ids.size`.
 * An open action is always reconciled against the current set, so a deselect
 * cannot leave a BottomSheet bound to a row that is no longer selected.
 */

export type ActionContext =
  | null
  | { type: 'confirm-delete' }
  | { type: 'item-actions'; id: number }
  | { type: 'status'; id: number }
  | { type: 'followup'; id: number }

export type SelectionState = {
  ids: ReadonlySet<number>
  action: ActionContext
}

export function emptySelection(): SelectionState {
  return { ids: new Set(), action: null }
}

export function enterSelection(id: number): SelectionState {
  return { ids: new Set([id]), action: null }
}

export function isSelecting(state: SelectionState): boolean {
  return state.ids.size > 0
}

function isBoundToItem(
  action: ActionContext,
): action is { type: 'item-actions' | 'status' | 'followup'; id: number } {
  return action != null && action.type !== 'confirm-delete'
}

/** Close any action that no longer belongs to the live selection. */
export function reconcileAction(ids: ReadonlySet<number>, action: ActionContext): ActionContext {
  if (ids.size === 0) return null
  if (!action) return null
  if (action.type === 'confirm-delete') return action
  if (isBoundToItem(action)) {
    if (!ids.has(action.id)) return null
    // Per-item sheets (פעולות / סטטוס / מעקב) only make sense for a single row.
    if (ids.size !== 1) return null
  }
  return action
}

export function toggleSelection(state: SelectionState, id: number): SelectionState {
  const ids = new Set(state.ids)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  return { ids, action: reconcileAction(ids, state.action) }
}

export function setAction(state: SelectionState, action: ActionContext): SelectionState {
  return { ids: state.ids, action: reconcileAction(state.ids, action) }
}
