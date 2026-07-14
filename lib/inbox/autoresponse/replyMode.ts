/** Pure helpers for Auto Response reply mode / delay (no DB). */

export type AutoResponseReplyMode = 'ai' | 'fixed'

export const MAX_DELAY_SECONDS = 3600
export const MAX_FIXED_BODY_LENGTH = 1000

export function parseReplyMode(value: string | null | undefined): AutoResponseReplyMode {
  return value === 'fixed' ? 'fixed' : 'ai'
}

export function clampDelaySeconds(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(Math.floor(value), 0), MAX_DELAY_SECONDS)
}
