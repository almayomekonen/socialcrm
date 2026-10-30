'use client'

import Icon from '@/lib/Icon'
import { HoverTooltip } from '@/components/ui/HoverTooltip'
import AutomationRowMenu from './AutomationRowMenu'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import { actionFallbackIn, automationSentenceIn, localizeAction, localizeEvent } from '@/lib/automations/catalogI18n'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import type { Translator } from '@/lib/i18n/translate'
import { getAction, getEvent } from '@/lib/automations/catalog/registry'
import type { Condition } from '@/lib/automations/conditions'
import type { DefinitionStatus } from '@/db/automations/definitions'
import type { Timing } from '@/lib/automations/timing'

export type AutomationCardData = {
  id: number
  name: string
  status: DefinitionStatus
  eventKey: string
  conditions: Condition[]
  subject: string
  timing: Timing
  counts: { sent: number; wouldSend: number; skipped: number; failed: number }
  /** The CATALOG action this automation runs. Read from the row, never assumed. */
  actionKey: string | null
  /** The bound connection is missing or unhealthy — never fails silently. */
  connectionProblem?: boolean
  /** ISO timestamp of the last mutation. */
  updatedAt?: string | null
}

/** 7-day volume. Observation-mode runs count as runs — they happened. */
export const runCount = (c: AutomationCardData['counts']) => c.sent + c.wouldSend

/**
 * The week in one clause. ADR-009: a run that only WOULD have been sent is
 * never reported as a send, so the two counts are named separately even though
 * `runCount` adds them. Absent when there is nothing true to say — never a "0".
 */
function activityPhrase(c: AutomationCardData['counts'], t: Translator): string | null {
  const parts = [
    c.sent > 0 ? t('admin.automations.row.sent', { count: String(c.sent) }) : null,
    c.wouldSend > 0 ? t('admin.automations.row.wouldSend', { count: String(c.wouldSend) }) : null,
  ].filter(Boolean)
  return parts.length > 0 ? t('admin.automations.row.week', { activity: parts.join(' · ') }) : null
}

/**
 * Relative time in the interface language, computed from a server-provided ISO string.
 */
function updatedLabel(iso: string | null | undefined, now: number, t: Translator): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const mins = Math.max(0, Math.round((now - then) / 60000))
  if (mins < 1) return t('admin.automations.row.updated.now')
  if (mins < 60) return t('admin.automations.row.updated.minutes', { count: String(mins) })
  const hours = Math.round(mins / 60)
  if (hours < 24) return t('admin.automations.row.updated.hours', { count: String(hours) })
  const days = Math.round(hours / 24)
  if (days === 1) return t('admin.automations.row.updated.yesterday')
  return t('admin.automations.row.updated.days', { count: String(days) })
}

type Props = {
  data: AutomationCardData
  busy?: boolean
  /** Milliseconds, passed from the parent so every row agrees on "now". */
  now?: number
  onEdit: () => void
  onToggle: () => void
  onDuplicate: () => void
  onDelete: () => void
  onActivity: () => void
}

/**
 * One installed automation, as a row in the control centre.
 *
 * The row is the quietest thing on the page on purpose: a name, one line of
 * fact, and the single control that matters. Everything else — edit, log,
 * duplicate, delete — lives behind one menu button rather than four ghost
 * buttons that appear on hover. The old row revealed all four on `group-hover`,
 * which put them out of reach of anything without a pointer.
 *
 * The sub-line reports only what is TRUE: a problem when there is one, the
 * week's sends when there were any, otherwise the state. Never a "0".
 */
export default function AutomationCard({
  data,
  busy,
  now = Date.now(),
  onEdit,
  onToggle,
  onDuplicate,
  onDelete,
  onActivity,
}: Props) {
  const hasError = data.counts.failed > 0 || data.connectionProblem === true
  const isActive = data.status === 'active'
  /**
   * GREEN IS THE SAVED STATE, NOT PERMISSION TO RUN.
   *
   * An automation the customer switched on stays switched on when a
   * subscription lapses: the toggle reflects `status`, which entitlement never
   * touches. That is honest about their configuration but silent about why
   * nothing is happening, so an enabled automation on a lapsed plan carries a
   * lock beside it that explains the difference. Nothing here reads or writes
   * the definition, and the toggle's own colour is unchanged.
   */
  const expired = useAccessDenied()
  const configuredButPaused = expired && isActive
  const t = useT()
  const region = useRegionAttrs()
  const updated = updatedLabel(data.updatedAt, now, t)

  const problem = hasError
    ? data.connectionProblem
      ? t('admin.automations.row.connectionProblem')
      : t('admin.automations.row.failed', { count: String(data.counts.failed) })
    : null

  const sub =
    data.status === 'draft'
      ? t('admin.automations.row.draft')
      : [activityPhrase(data.counts, t), updated].filter(Boolean).join(' · ') ||
        (data.status === 'paused' ? t('admin.automations.row.paused') : t('admin.automations.row.active'))

  /*
   * The row shows a name and a fact; the sentence that says what the automation
   * actually DOES is carried for assistive tech only. Sighted users get it from
   * the sheet, but a screen reader has no hover and no glance — without this the
   * row would announce a name and a run count and nothing about the behaviour.
   */
  const sentence = automationSentenceIn(
    {
      event: localizeEvent(getEvent(data.eventKey), t.locale),
      conditions: data.conditions,
      actionTitle: localizeAction(data.actionKey ? getAction(data.actionKey) : null, t.locale)?.title ?? actionFallbackIn(t.locale),
      subject: data.subject,
      timing: data.timing,
    },
    t.locale,
  )

  return (
    <div className='group/row -mx-3 flex items-center gap-3.5 rounded-[10px] px-3 py-2.5 transition-colors duration-150 hover:bg-[#f7f8fa]'>
      <button
        type='button'
        onClick={onEdit}
        disabled={busy}
        className='min-w-0 flex-1 text-start disabled:pointer-events-none'
      >
        <span
          className={`block truncate text-md font-medium ${isActive ? 'text-ink' : 'text-[#6b7a8d]'}`}
        >
          {data.name}
        </span>
        <span className={`mt-0.5 block truncate text-[13px] ${hasError ? 'text-error' : 'text-[#aab3c0]'}`}>
          {problem ? (
            <>
              <span>{t('admin.automations.row.needsAttention')}</span>
              {` · ${problem}`}
            </>
          ) : (
            sub
          )}
        </span>
        <span className='sr-only'>{sentence}</span>
      </button>

      <AutomationRowMenu
        name={data.name}
        busy={busy}
        onEdit={onEdit}
        onActivity={onActivity}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />

      {configuredButPaused && (
        <HoverTooltip
          className='inline-flex flex-none items-center rounded-sm focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning-text'
          label={t('admin.automations.row.lockLabel')}
          region={region}
          panelClassName='pointer-events-none rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning-text shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]'
          content={
            <>
              <p className='font-semibold'>{t('admin.automations.row.lockTitle')}</p>
              <p className='mt-0.5'>{t('admin.automations.row.lockBody')}</p>
              <p className='mt-1'>{t('admin.automations.row.lockRenew')}</p>
            </>
          }
        >
          <Icon name='lock' type='sol' className='size-3.5 bg-warning-text' />
        </HoverTooltip>
      )}

      <button
        type='button'
        aria-pressed={isActive}
        aria-label={isActive ? t('admin.automations.row.pauseNamed', { name: data.name }) : t('admin.automations.row.resumeNamed', { name: data.name })}
        title={isActive ? t('admin.automations.row.pause') : t('admin.automations.row.resume')}
        disabled={busy}
        onClick={onToggle}
        className={`relative h-5 w-8.5 flex-none rounded-full transition-colors duration-150 disabled:opacity-50 ${
          isActive ? 'bg-success' : 'bg-[#e6e8ed]'
        }`}
      >
        <span
          aria-hidden='true'
          className={`absolute top-0.5 size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[inset-inline] duration-150 ${
            isActive ? 'end-0.5' : 'start-0.5'
          }`}
        />
      </button>
    </div>
  )
}
