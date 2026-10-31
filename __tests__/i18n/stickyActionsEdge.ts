import { expect } from 'vitest'

/**
 * The tables' sticky actions column (final UI audit, fix F): it is each row's
 * LAST cell, so it pins to the left edge in RTL (Hebrew, Arabic — unchanged)
 * and to the right edge in LTR. Returns the pinned edge of every sticky cell
 * and checks each one is its row's last cell.
 */
export function stickyEdges(root: ParentNode): string[] {
  const cells = [...root.querySelectorAll('th.sticky, td.sticky')].filter((c) => c.tagName === 'TH' || c.tagName === 'TD')
  for (const c of cells) expect(c, c.outerHTML.slice(0, 80)).toBe(c.parentElement!.lastElementChild)
  return cells.map((c) => {
    const cls = c.className.split(/\s+/)
    return cls.includes('right-0') && !cls.includes('left-0') ? 'right' : cls.includes('left-0') && !cls.includes('right-0') ? 'left' : `? ${c.className}`
  })
}

/** he / ar pin left (as before), en pins right; the table's direction matches. */
export function expectStickyEdges(byLocale: Record<'he' | 'en' | 'ar', ParentNode>) {
  const he = stickyEdges(byLocale.he)
  expect(he.length, 'the table renders its actions column').toBeGreaterThan(1)
  expect(new Set(he)).toEqual(new Set(['left']))
  expect(stickyEdges(byLocale.ar)).toEqual(he)
  expect(stickyEdges(byLocale.en)).toEqual(he.map(() => 'right'))
  const cell = byLocale.en.querySelector('td.sticky, th.sticky')!
  expect(cell.closest('[dir]')?.getAttribute('dir'), 'the English table reads left-to-right').toBe('ltr')
}
