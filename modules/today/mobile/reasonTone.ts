/**
 * Presentation tone for a Today reason / window hint.
 *
 * Uses the existing Hebrew labels the view-model already ships — no new query,
 * no contract change. Overdue must stay distinguishable from a quiet gray
 * subtitle (the Leads list already does this with `text-error-text`).
 */

import type { ReasonCode, WindowState } from '@/lib/today/types'

export type TodayReasonTone = 'error' | 'warning' | null

/**
 * Tone from the stable reason CODE — what production rows use. Same mapping the
 * Hebrew labels always implied: overdue → error; due today / waiting → warning.
 */
export function toneForReason(code: ReasonCode | null | undefined): TodayReasonTone {
  if (code === 'FOLLOWUP_OVERDUE' || code === 'OVERDUE_TASK') return 'error'
  if (code === 'FOLLOWUP_DUE_TODAY' || code === 'WAITING_REPLY' || code === 'OPEN_LOOP_SLA') return 'warning'
  return null
}

/** Tone from the WhatsApp window state: a closed window is a warning. */
export function toneForWindow(state: WindowState | null | undefined): TodayReasonTone {
  return state === 'CLOSED' ? 'warning' : null
}

/**
 * @deprecated LEGACY, Hebrew text only. Used solely for rows that carry no
 * resolved `tone` (hand-built rows; the frozen a11y suite asserts this API).
 * Production rows are built by viewModel.ts with `tone` from codes, so their
 * display text — in any language — is never read.
 */
export function todayReasonTone(reason: string): TodayReasonTone {
  if (reason.includes('באיחור')) return 'error'
  if (reason === 'מעקב להיום' || reason.startsWith('ממתין')) return 'warning'
  return null
}

/** @deprecated LEGACY, Hebrew text only — see `todayReasonTone`. */
export function todayWindowHintTone(hint: string): TodayReasonTone {
  return hint.includes('נסגר') ? 'warning' : null
}

export function todayToneClass(tone: TodayReasonTone): { text: string; dot: string } | null {
  if (tone === 'error') return { text: 'text-error-text', dot: 'bg-error-text' }
  if (tone === 'warning') return { text: 'text-warning-text', dot: 'bg-warning-text' }
  return null
}
