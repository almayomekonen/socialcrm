import type { TriggerType } from './types'
import type { Timing } from './timing'

/**
 * "One automation = one sentence" (spec §3.2) made concrete: every automation
 * is legible on its card without opening it — the antidote to the forgotten
 * automation (spec §11.10).
 *
 * Pure and dependency-free so both the server page and client components can
 * use it.
 */

// Mirrors the canonical lead-status labels in
// components/clients/LeadStatusCell.tsx (a 'use client' module — not imported
// here to keep this pure). Five words; if the product renames a status, both
// must move together.
const STATUS_LABELS: Record<string, string> = {
  new: 'חדש',
  contacted: 'בטיפול',
  interested: 'מעוניין',
  closed: 'סגור',
  lost: 'אבוד',
}

const SOURCE_LABELS: Record<string, string> = {
  facebook: 'מפייסבוק',
  whatsapp: 'מוואטסאפ',
  instagram: 'מאינסטגרם',
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return ''
  return STATUS_LABELS[status] ?? status
}

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return ''
  return SOURCE_LABELS[source] ?? `מ${source}`
}

export function triggerPhrase(trigger: TriggerType, sourceFilter: string | null, targetStatus: string | null): string {
  if (trigger === 'status_changed') {
    const label = statusLabel(targetStatus)
    return label ? `כשסטטוס הליד משתנה ל"${label}"` : 'כשסטטוס הליד משתנה'
  }
  const src = sourceLabel(sourceFilter)
  return src ? `כשליד חדש נכנס ${src}` : 'כשליד חדש נכנס'
}

export function timingPhrase(timing: Timing): string {
  if (timing.kind === 'preset') {
    if (timing.preset === 'immediate') return 'מיד'
    return timing.preset === 'one_hour' ? 'אחרי שעה' : 'אחרי יום'
  }
  const unit = timing.unit === 'hours' ? (timing.value === 1 ? 'שעה' : 'שעות') : timing.value === 1 ? 'יום' : 'ימים'
  return timing.value === 1 ? `אחרי ${unit}` : `אחרי ${timing.value} ${unit}`
}

/** The full card line: כש… ← שולח "…" ← מתי. */
export function automationSentence(input: {
  trigger: TriggerType
  sourceFilter: string | null
  targetStatus: string | null
  subject: string
  timing: Timing
}): string {
  const parts = [
    triggerPhrase(input.trigger, input.sourceFilter, input.targetStatus),
    `שולח "${input.subject}"`,
    timingPhrase(input.timing),
  ]
  return parts.join(' · ')
}
