// Today brief — deterministic labels for qualifying states. Pure. The display
// string is a fixed function of a stable reason CODE (+ the interface locale),
// computed server-side and put in the DTO, so the UI never maps state → copy
// itself and no logic ever reads the display text. Terminology per the product
// rules (ליד / מעקב; never לקוח / סוכן). Hebrew is the default for every
// caller that does not pass a locale (MCP, agent, mobile API, inbox).

import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'
import type { QualifyingState, ReasonCode } from './types'

const REASON_KEY: Record<ReasonCode, MessageKey> = {
  WAITING_REPLY: 'today.reason.WAITING_REPLY',
  FOLLOWUP_OVERDUE: 'today.reason.FOLLOWUP_OVERDUE',
  FOLLOWUP_DUE_TODAY: 'today.reason.FOLLOWUP_DUE_TODAY',
  NEW_INBOUND: 'today.reason.NEW_INBOUND',
  OVERDUE_TASK: 'today.reason.OVERDUE_TASK',
  OPEN_LOOP_SLA: 'today.reason.OPEN_LOOP_SLA',
  NEW_INBOUND_TODAY: 'today.reason.NEW_INBOUND_TODAY',
  NO_ANSWER_LAST: 'today.reason.NO_ANSWER_LAST',
}

export function reasonLabel(code: ReasonCode, locale: UiLocale = 'he'): string {
  return translatorFor(locale)(REASON_KEY[code])
}

export function reasonFor(state: QualifyingState, locale: UiLocale = 'he'): string {
  return reasonLabel(state, locale)
}
