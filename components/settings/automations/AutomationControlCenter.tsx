'use client'

import Icon from '@/lib/Icon'
import type { IdentityProblem } from '@/lib/automations/identity'
import { MINUTES_SAVED_PER_RUN, timeSaved } from '@/lib/automations/dashboardDemo'
import { identityProblemIn } from '@/lib/automations/catalogI18n'
import { useT } from '@/lib/i18n/I18nProvider'
import type { Translator } from '@/lib/i18n/translate'
import AutomationCard, { runCount, type AutomationCardData } from './AutomationCard'

/**
 * The control centre — what is running, right now, and the one thing worth
 * doing next.
 *
 * It is a PANEL, not a dashboard: a single hairline separates it from the
 * library, and inside it nothing is boxed. Sections are told apart by a rule
 * and by type weight, which is the whole reason the page can carry this much
 * information and still read as calm.
 *
 * DELIBERATELY ABSENT: the sparkline the concept draws under "נחסך השבוע".
 * Nothing in the system records a per-day series, so its seven bars could only
 * be decoration shaped like evidence. The figure above it survives because
 * `timeSaved()` derives it from real run counts and labels its own basis.
 */

type Props = {
  automations: AutomationCardData[]
  /** Already filtered by the shared search. Empty ≠ "you have none". */
  visible: AutomationCardData[]
  handled: number
  waiting: number
  now: number
  busyId: number | null
  observationMode: boolean
  identityProblem: IdentityProblem | null
  onCreate: () => void
  onEdit: (a: AutomationCardData) => void
  onToggle: (a: AutomationCardData) => void
  onDuplicate: (a: AutomationCardData) => void
  onDelete: (a: AutomationCardData) => void
  onActivity: (a: AutomationCardData) => void
}

/** Relative time over the newest mutation — the panel's "as of". */
function lastTouched(automations: AutomationCardData[], now: number, t: Translator): string | null {
  const stamps = automations
    .map((a) => (a.updatedAt ? new Date(a.updatedAt).getTime() : NaN))
    .filter((t) => Number.isFinite(t))
  if (stamps.length === 0) return null
  const mins = Math.max(0, Math.round((now - Math.max(...stamps)) / 60000))
  if (mins < 1) return t('admin.automations.center.touched.now')
  if (mins < 60) return t('admin.automations.center.touched.minutes', { count: String(mins) })
  const hours = Math.round(mins / 60)
  if (hours < 24) return t('admin.automations.center.touched.hours', { count: String(hours) })
  return t('admin.automations.center.touched.days', { count: String(Math.round(hours / 24)) })
}

export default function AutomationControlCenter({
  automations,
  visible,
  handled,
  waiting,
  now,
  busyId,
  observationMode,
  identityProblem,
  onCreate,
  onEdit,
  onToggle,
  onDuplicate,
  onDelete,
  onActivity,
}: Props) {
  const active = automations.filter((a) => a.status === 'active')
  const drafts = automations.filter((a) => a.status === 'draft')
  const failing = automations.filter((a) => a.counts.failed > 0 || a.connectionProblem === true)
  const t = useT()
  const runs = automations.reduce((n, a) => n + runCount(a.counts), 0)
  const saved = t.locale === 'he' ? timeSaved(runs) : savedIn(runs, t)

  const state = failing.length > 0 ? 'error' : active.length > 0 ? 'ok' : 'idle'
  const stateLabel = t(state === 'error' ? 'admin.automations.center.state.error' : state === 'ok' ? 'admin.automations.center.state.ok' : 'admin.automations.center.state.idle')
  const touched = lastTouched(automations, now, t)

  const counts = [
    active.length > 0 ? t('admin.automations.center.active', { count: String(active.length) }) : null,
    drafts.length > 0 ? t('admin.automations.center.drafts', { count: String(drafts.length) }) : null,
  ].filter(Boolean)

  return (
    /*
     * `pt-6` matches the library's, so the panel's first row starts on the same
     * line as the h1 beside it — and it is the same 24px every other settings
     * page gets. Padding rather than margin keeps the column's background and
     * hairline running the full height.
     */
    <aside className='flex w-full flex-none flex-col gap-9 border-e border-border bg-[#fcfcfd] px-8.5 pb-10 pt-6 desktop:w-94'>
      {observationMode && (
        <p className='rounded-[10px] bg-[#f1f2f5] px-3.5 py-3 text-[13px] leading-[1.55] text-[#6b7a8d]'>
          {t('admin.automations.center.observation')}
        </p>
      )}
      {identityProblem && (
        <div className='flex items-start gap-2 rounded-[10px] bg-warning-bg px-3.5 py-3 text-[13px] leading-[1.55] text-warning-text' role='alert'>
          <Icon name='triangle-exclamation' type='reg' className='mt-0.5 size-4 shrink-0 bg-warning' />
          {identityProblemIn(identityProblem, t.locale)}
        </div>
      )}

      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2.5'>
          <span
            aria-hidden='true'
            className={`size-1.75 rounded-full ${
              state === 'error'
                ? 'bg-error shadow-[0_0_0_3px_var(--color-error-bg)]'
                : state === 'ok'
                  ? 'bg-success shadow-[0_0_0_3px_var(--color-success-bg)]'
                  : 'bg-[#c2c9d4]'
            }`}
          />
          <span className='text-[14px] font-semibold text-ink'>{stateLabel}</span>
        </div>
        {touched && <span className='text-[12.5px] text-[#b3bbc6]'>{touched}</span>}
      </div>

      <div className='flex flex-col gap-2.5'>
        <p className='text-[33px] font-semibold leading-[1.15] tracking-[-0.035em] text-ink'>{t('admin.automations.center.handled', { count: String(handled) })}</p>
        <p className='text-[14.5px] leading-[1.6] text-[#8b98a8]'>{t('admin.automations.center.handledBody')}</p>
      </div>

      <div className='flex min-h-0 flex-col gap-3.5'>
        <div className='flex items-baseline justify-between pb-0.5'>
          <h2 className='text-[11.5px] font-semibold tracking-[0.14em] text-[#aab3c0]'>{t('admin.automations.center.mine')}</h2>
          {counts.length > 0 && <span className='text-[13px] text-[#c2c9d4]'>{counts.join(' · ')}</span>}
        </div>

        {automations.length === 0 ? (
          <div className='flex flex-col items-start gap-3'>
            <p className='text-[14px] leading-[1.6] text-[#8b98a8]'>
              {t('admin.automations.center.none')}
            </p>
            <button
              type='button'
              onClick={onCreate}
              className='text-[13.5px] font-semibold text-primary-text hover:underline'
            >
              {t('admin.automations.center.create')}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <p className='text-[13.5px] text-[#aab3c0]'>{t('admin.automations.center.noMatch')}</p>
        ) : (
          <div className='flex min-h-0 flex-col overflow-y-auto'>
            {visible.map((a) => (
              <AutomationCard
                key={a.id}
                data={a}
                now={now}
                busy={busyId === a.id}
                onEdit={() => onEdit(a)}
                onToggle={() => onToggle(a)}
                onDuplicate={() => onDuplicate(a)}
                onDelete={() => onDelete(a)}
                onActivity={() => onActivity(a)}
              />
            ))}
          </div>
        )}
      </div>

      {waiting > 0 && (
        <div className='flex flex-col gap-3 border-t border-[#eeeff2] pt-7'>
          <h2 className='text-[11.5px] font-semibold tracking-[0.14em] text-[#aab3c0]'>{t('admin.automations.center.recommendation')}</h2>
          <p className='text-[17px] font-semibold leading-normal tracking-[-0.012em] text-ink'>
            {t('admin.automations.center.waiting', { count: String(waiting) })}
          </p>
          <p className='text-[14.5px] leading-[1.65] text-[#8b98a8]'>
            {t('admin.automations.center.waitingBody')}
          </p>
          <div className='flex items-center gap-4 pt-1'>
            <button type='button' onClick={onCreate} className='text-[13.5px] font-semibold text-ink hover:underline'>
              {t('admin.automations.center.buildOne')}
            </button>
          </div>
        </div>
      )}

      {runs > 0 && (
        <div className='mt-auto flex flex-col gap-1.5 border-t border-[#eeeff2] pt-7'>
          <h2 className='text-[11.5px] font-semibold tracking-[0.14em] text-[#aab3c0]'>{t('admin.automations.center.savedTitle')}</h2>
          <p className='text-[26px] font-semibold tracking-[-0.02em] text-ink'>{saved.value}</p>
          <p className='text-[12.5px] text-[#b3bbc6]'>{saved.basis}</p>
        </div>
      )}
    </aside>
  )
}

/**
 * `timeSaved` (lib/automations/dashboardDemo, used as is in Hebrew) worded in
 * another interface language: the same estimate and the same rounding.
 */
function savedIn(runs: number, t: Translator): { value: string; basis: string } {
  const mins = runs * MINUTES_SAVED_PER_RUN
  const value =
    mins >= 60
      ? t('admin.automations.center.savedHours', { count: String(Math.round((mins / 60) * 10) / 10) })
      : t('admin.automations.center.savedMinutes', { count: String(mins) })
  return { value, basis: t('admin.automations.center.savedBasis', { count: String(MINUTES_SAVED_PER_RUN) }) }
}
