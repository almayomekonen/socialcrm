'use client'

import { getAction } from '@/lib/automations/catalog/registry'
import { localizeAction, localizeRequirement, timingPhraseIn } from '@/lib/automations/catalogI18n'
import { localizeTemplate } from '@/lib/automations/templateI18n'
import { useT } from '@/lib/i18n/I18nProvider'
import { dirFor } from '@/lib/i18n/config'
import type { TemplateView } from '@/lib/automations/templates/overview'
import AutomationFlowArt from './AutomationFlowArt'

/**
 * One template — a CELL, not a card.
 *
 * It carries no border, no radius and no shadow of its own. The library grid
 * draws a single hairline surface and lets a 1px gap fall between the cells, so
 * every divider on screen is shared by the two cells it separates. Give this
 * element a border of its own and the grid immediately reads as six floating
 * rectangles again, which is the whole thing the surface exists to avoid.
 *
 * Colour is spent on exactly two marks: the illustration's action, and the
 * install affordance. Everything else is the neutral ramp.
 *
 * Installed templates never reach here; the library filters them out.
 */
export default function AutomationTemplateCard({ view, onInstall }: { view: TemplateView; onInstall: () => void }) {
  const t = useT()
  const { availability, preview } = view
  const template = localizeTemplate(view.template, t.locale)
  const locked = localizeRequirement(availability.state === 'locked' ? availability.requirement : null, t.locale)

  /**
   * "מייל · מיידי" — the channel and the timing, both read off the first
   * automation the template would create rather than written per template.
   * A template whose preview is empty simply has no meta line.
   */
  const first = preview[0]
  const channel = first ? (localizeAction(getAction(first.actionKey), t.locale)?.title ?? null) : null
  const timing = template.automations[0]?.timing ?? null
  const meta = locked
    ? (locked.cta?.label ?? t('admin.automations.library.needsConnection'))
    : [channel, timing ? timingPhraseIn(timing, t.locale) : null].filter(Boolean).join(' · ')

  return (
    <button
      type='button'
      onClick={onInstall}
      aria-label={t('admin.automations.library.cellLabel', {
        action: locked ? (locked.cta?.label ?? t('admin.automations.library.connect')) : t('admin.automations.library.install'),
        title: template.title,
      })}
      className='group/tpl flex min-h-[212px] flex-col gap-[18px] bg-white px-6 pb-[22px] pt-[26px] text-start transition-colors duration-150 hover:bg-[#fafbfc] active:bg-[#f6f7f9] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary'
    >
      <span className='mb-0.5 flex h-11 items-center'>
        <AutomationFlowArt templateKey={template.key} />
      </span>

      <span className='flex flex-col gap-[7px]'>
        <span className='text-[17.5px] font-semibold tracking-[-0.012em] text-ink'>{template.title}</span>
        <span className='text-[14.5px] leading-[1.6] text-[#6b7a8d] text-pretty'>{template.description}</span>
      </span>

      <span className='mt-auto flex items-center justify-between pt-4'>
        <span className='text-[12.5px] tracking-[0.01em] text-[#b3bbc6]'>{meta}</span>
        <span
          className={`flex items-center gap-[5px] text-[13.5px] font-semibold transition-[gap] duration-150 group-hover/tpl:gap-[9px] ${
            locked ? 'text-[#98a3b8]' : 'text-primary-text'
          }`}
        >
          {locked ? (locked.cta?.label ?? t('admin.automations.library.connect')) : t('admin.automations.library.install')}
          {/* Points left — forward, in a right-to-left page (and mirrored to point right in a left-to-right one). */}
          <svg width='14' height='14' viewBox='0 0 24 24' fill='none' aria-hidden='true' className={dirFor(t.locale) === 'ltr' ? '-scale-x-100' : undefined}>
            <path
              d='M15 6l-6 6 6 6'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
        </span>
      </span>
    </button>
  )
}
