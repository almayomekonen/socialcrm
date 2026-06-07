/**
 * Viewport-aware placement for the Follow-Up floating menu.
 *
 * Pure (no DOM/window) so the edge behavior is unit-testable. Prefers the RTL
 * convention — menu's right edge aligned to the trigger, opening downward — but
 * flips horizontally/vertically when space runs out and finally clamps so the
 * menu is ALWAYS fully inside the viewport. Width is deterministic so the clamp
 * is exact and the menu can never clip.
 */

export const MENU_WIDTH = 224
export const MENU_EST_HEIGHT = 248 // safe overestimate; only used to decide the vertical flip
export const MENU_MARGIN = 8

export type Rect = { top: number; bottom: number; left: number; right: number }
export type Viewport = { width: number; height: number }
export type MenuPosition = { top: number; left: number; width: number }

export function placeFollowUpMenu(trigger: Rect, vp: Viewport): MenuPosition {
  const width = Math.min(MENU_WIDTH, vp.width - MENU_MARGIN * 2)

  // Horizontal: align right edge to the trigger (extend left, RTL). If that
  // clips the left edge, anchor to the trigger's left (extend right). Then clamp.
  let left = trigger.right - width
  if (left < MENU_MARGIN) left = trigger.left
  left = Math.min(Math.max(left, MENU_MARGIN), vp.width - width - MENU_MARGIN)

  // Vertical: open below; flip above when there isn't room; clamp inside.
  let top = trigger.bottom + 4
  if (top + MENU_EST_HEIGHT > vp.height - MENU_MARGIN) {
    const above = trigger.top - MENU_EST_HEIGHT - 4
    top = above >= MENU_MARGIN ? above : Math.max(MENU_MARGIN, vp.height - MENU_EST_HEIGHT - MENU_MARGIN)
  }
  top = Math.max(top, MENU_MARGIN)

  return { top, left, width }
}
