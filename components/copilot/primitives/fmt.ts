import type { CopilotActionId } from '@/lib/copilot/copilotResponse'

/** Local-timezone HH:MM. Empty string on parse failure. */
export function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function systemLabel(actionId: CopilotActionId | null, fallback: string): string {
  if (fallback && fallback.trim().length > 0) return fallback
  if (actionId === 'draft-followup-message') return 'הודעת followup'
  if (actionId === 'next-best-step') return 'הצעד הבא'
  if (actionId === 'ask-question') return 'שאלה'
  return 'פעולת AI'
}
