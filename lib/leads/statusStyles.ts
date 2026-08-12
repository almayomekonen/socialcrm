/**
 * Lead status presentation — the single source, importable from BOTH sides.
 *
 * WHY THIS FILE EXISTS. These values used to live in
 * `components/clients/LeadStatusCell.tsx`, which is a `'use client'` module.
 * Importing a plain object across the RSC boundary does not give a Server
 * Component the object: it gives a client-reference proxy whose properties read
 * as `undefined`. A Server Component doing `STATUS_STYLES[status].bg` therefore
 * throws at render — which is exactly what the mobile lead card did.
 *
 * Framework-neutral by design: no `'use client'`, no React import, no JSX. Both
 * server and client code can import it, and `LeadStatusCell` re-exports it so
 * every existing import path keeps working unchanged.
 *
 * The Hebrew labels are the product vocabulary (`ux-guidelines.md` §6) and the
 * keys are the `LeadStatus` union — never re-declare either elsewhere.
 */

export type LeadStatusStyle = {
  label: string
  bg: string
  text: string
  border: string
  dot: string
}

export const STATUS_STYLES: Record<string, LeadStatusStyle> = {
  new:       { label: 'חדש',     bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500' },
  contacted: { label: 'בטיפול',  bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', dot: 'bg-yellow-500' },
  interested:{ label: 'מעוניין', bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-500' },
  closed:    { label: 'סגור',    bg: 'bg-gray-100',  text: 'text-gray-600',   border: 'border-gray-200',   dot: 'bg-gray-400' },
  lost:      { label: 'אבוד',    bg: 'bg-red-50',    text: 'text-red-600',    border: 'border-red-200',    dot: 'bg-red-500' },
}

export const STATUS_OPTIONS = Object.entries(STATUS_STYLES).map(([value, { label }]) => ({ value, label }))

/**
 * Style for a status, never undefined.
 *
 * Callers render `${style.bg}` directly, so a missing key must not produce
 * `undefined` — an unknown status (legacy row, future value) falls back to
 * `new` rather than crashing the screen it appears on.
 */
export function statusStyle(status: string | null | undefined): LeadStatusStyle {
  return STATUS_STYLES[status ?? 'new'] ?? STATUS_STYLES.new
}
