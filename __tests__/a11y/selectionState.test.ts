import { describe, expect, it } from 'vitest'
import {
  emptySelection,
  enterSelection,
  isSelecting,
  reconcileAction,
  setAction,
  toggleSelection,
} from '@/components/mobile/selectionState'

describe('mobile selection / action-context invariant', () => {
  it('stores ids only — enterSelection does not accept a row object', () => {
    const state = enterSelection(9)
    expect([...state.ids]).toEqual([9])
    expect(state.action).toBeNull()
    expect(isSelecting(state)).toBe(true)
  })

  it('deselecting the last id exits selection and clears action context', () => {
    let state = setAction(enterSelection(9), { type: 'confirm-delete' })
    expect(state.action?.type).toBe('confirm-delete')
    state = toggleSelection(state, 9)
    expect([...state.ids]).toEqual([])
    expect(state.action).toBeNull()
    expect(isSelecting(state)).toBe(false)
  })

  it('deselecting the bound item closes its action sheet even if others remain', () => {
    let state = enterSelection(1)
    state = toggleSelection(state, 2)
    state = setAction(state, { type: 'item-actions', id: 1 })
    // two selected → per-item sheet is invalid
    expect(state.action).toBeNull()

    state = setAction({ ids: new Set([1]), action: null }, { type: 'item-actions', id: 1 })
    expect(state.action).toEqual({ type: 'item-actions', id: 1 })
    state = toggleSelection(state, 2)
    expect([...state.ids].sort()).toEqual([1, 2])
    expect(state.action).toBeNull()
  })

  it('deselecting A while its sheet is open clears A and closes the sheet', () => {
    let state = setAction(enterSelection(1), { type: 'item-actions', id: 1 })
    state = toggleSelection(state, 2)
    state = setAction({ ids: new Set([1, 2]), action: { type: 'item-actions', id: 1 } }, { type: 'item-actions', id: 1 })
    expect(state.action).toBeNull()

    state = { ids: new Set([1, 2]), action: { type: 'status', id: 1 } }
    state = toggleSelection(state, 1)
    expect([...state.ids]).toEqual([2])
    expect(state.action).toBeNull()
  })

  it('confirm-delete stays open while any id remains', () => {
    let state = setAction(enterSelection(1), { type: 'confirm-delete' })
    state = toggleSelection(state, 2)
    expect(state.action?.type).toBe('confirm-delete')
    state = toggleSelection(state, 1)
    expect([...state.ids]).toEqual([2])
    expect(state.action?.type).toBe('confirm-delete')
  })

  it('empty ids always reconcile to a null action', () => {
    expect(reconcileAction(new Set(), { type: 'confirm-delete' })).toBeNull()
    expect(reconcileAction(new Set(), { type: 'item-actions', id: 3 })).toBeNull()
    expect(emptySelection().action).toBeNull()
  })
})
