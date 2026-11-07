'use client'

import { useState } from 'react'
import Link from 'next/link'
import Icon from '@/lib/Icon'
import LeadAvatar from '@/components/ui/lead-avatar'
import type { BriefItem } from '@/lib/today/types'
import { WAIT_STATE_TONE } from './waitTone'
import { badgeOutline, btn, toneIcon } from '@/components/home/dashboard/ui'
import type { UiLocale } from '@/lib/i18n/config'
import { dirFor } from '@/lib/i18n/config'
import { useT } from '@/lib/i18n/I18nProvider'

// The rest of the brief as a shadcn data table (dashboard-01): 10 rows per page
// with the shadcn pagination footer (rows-per-page, "page X of Y", first / previous
// / next / last).
//
// OWNER DECISION 2026-11-07: the Today list is paginated on desktop. This
// supersedes INV-15 ("Today never paginates") for this table. Every item is still
// delivered to the client and reachable — pagination only changes how many rows
// are visible at once; nothing is capped or dropped.
//
// The wait badge carries text plus a toned icon (never colour-only).
const PAGE_SIZES = [10, 20, 30, 50] as const
const iconBtn = `${btn.base} ${btn.ghost} ${btn.icon}`
const pagerBtn = `${btn.base} ${btn.outline} ${btn.icon} hover:bg-primary-tint`
const th = 'h-10 px-2 text-start align-middle font-medium whitespace-nowrap text-ink'
const td = 'p-2 align-middle'

// `locale` is accepted for API symmetry with the server components; strings come
// from the layout's I18nProvider (same value).
export default function BriefList({ items }: { items: BriefItem[]; locale?: UiLocale }) {
  const t = useT()
  const rtl = dirFor(t.locale) === 'rtl'
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])
  const [pageIndex, setPageIndex] = useState(0)

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const page = Math.min(pageIndex, pageCount - 1)
  const from = items.length === 0 ? 0 : page * pageSize + 1
  const to = Math.min(items.length, (page + 1) * pageSize)
  const rows = items.slice(page * pageSize, (page + 1) * pageSize)

  const detailsOf = (it: BriefItem) => [it.waitingFor ? it.reason : null, it.windowHint].filter(Boolean).join(' · ')
  // A column that is empty for every row says nothing (CLAUDE.md §11): omit it.
  const hasDetails = items.some((it) => detailsOf(it) !== '')

  // Chevrons point in reading direction: "next" is left in Hebrew/Arabic.
  const back = rtl ? 'right' : 'left'
  const fwd = rtl ? 'left' : 'right'

  return (
    <div className='flex flex-col gap-4'>
      <div className='overflow-hidden rounded-lg border border-border bg-surface'>
        <div className='w-full overflow-x-auto'>
          <table className='w-full caption-bottom text-sm'>
            <thead className='bg-neutral-bg'>
              <tr className='border-b border-border'>
                <th className={`${th} ps-4`}>{t('today.list.colLead')}</th>
                <th className={th}>{t('today.list.colStatus')}</th>
                <th className={th}>{t('today.list.colSource')}</th>
                {hasDetails && <th className={th}>{t('today.list.colDetails')}</th>}
                <th className={`${th} pe-4 text-end`}>
                  <span className='sr-only'>{t('today.list.colActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => {
                const href = it.href ?? `/clients/${it.id}/summary`
                const chip = it.waitingFor ?? it.reason
                const tone = WAIT_STATE_TONE[it.state]
                // Same rule as the mission card: only a real thread link earns the WhatsApp action.
                const openConversation = Boolean(it.conversationId || it.href?.startsWith('/inbox'))
                return (
                  <tr key={it.id} className='h-14 border-b border-border transition-colors last:border-0 hover:bg-bg'>
                    <td className={`${td} ps-4`}>
                      <div className='flex items-center gap-3'>
                        <LeadAvatar name={it.name} size='sm' fallback={t('today.list.avatarFallback')} />
                        <Link
                          href={href}
                          className='truncate font-medium text-ink outline-none hover:text-primary-text hover:underline focus-visible:ring-[3px] focus-visible:ring-primary/25'
                        >
                          {it.name || '—'}
                        </Link>
                      </div>
                    </td>
                    <td className={td}>
                      <span data-tone={tone} className={`${badgeOutline} px-1.5 text-gray-600 tabular-nums`}>
                        <Icon name='clock' className={`size-3 shrink-0 ${toneIcon[tone]}`} />
                        {chip}
                      </span>
                    </td>
                    <td className={td}>{it.source && <span className={`${badgeOutline} px-1.5 text-gray-600`}>{it.source}</span>}</td>
                    {hasDetails && <td className={`${td} max-w-72 truncate text-gray-500`}>{detailsOf(it)}</td>}
                    <td className={`${td} pe-4`}>
                      <div className='flex justify-end gap-1'>
                        {openConversation && (
                          <Link
                            href={href}
                            aria-label={t('today.list.whatsappWith', { name: it.name || t('today.mission.leadFallback') })}
                            className={`${iconBtn} hover:bg-success-bg`}
                          >
                            <Icon name='whatsapp' type='sol' className='size-4 shrink-0 bg-success' />
                          </Link>
                        )}
                        {it.phone && (
                          <a
                            href={`tel:${it.phone}`}
                            aria-label={t('today.mission.callName', { name: it.name || t('today.mission.leadFallback') })}
                            className={iconBtn}
                          >
                            <Icon name='phone' className='size-4 shrink-0 bg-primary' />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <nav aria-label={t('today.list.title')} className='flex flex-wrap items-center justify-between gap-4 px-2'>
        <p className='text-sm text-gray-500 tabular-nums'>{t('today.list.showing', { from, to, total: items.length })}</p>
        <div className='flex flex-wrap items-center gap-6 lg:gap-8'>
          <label className='flex items-center gap-2 text-sm font-medium text-ink'>
            {t('today.list.rowsPerPage')}
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPageIndex(0)
              }}
              className='h-8 w-20 rounded-md border border-border bg-surface ps-3 pe-7 text-sm text-ink shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-primary/25'
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className='text-sm font-medium text-ink tabular-nums'>{t('today.list.pageOf', { page: page + 1, total: pageCount })}</span>
          <div className='flex items-center gap-2'>
            <button type='button' aria-label={t('today.list.firstPage')} disabled={page === 0} onClick={() => setPageIndex(0)} className={pagerBtn}>
              <Icon name={`chevrons-${back}`} className='size-3.5 shrink-0 bg-ink' />
            </button>
            <button type='button' aria-label={t('today.list.prevPage')} disabled={page === 0} onClick={() => setPageIndex(page - 1)} className={pagerBtn}>
              <Icon name={`chevron-${back}`} className='size-3.5 shrink-0 bg-ink' />
            </button>
            <button
              type='button'
              aria-label={t('today.list.nextPage')}
              disabled={page >= pageCount - 1}
              onClick={() => setPageIndex(page + 1)}
              className={pagerBtn}
            >
              <Icon name={`chevron-${fwd}`} className='size-3.5 shrink-0 bg-ink' />
            </button>
            <button
              type='button'
              aria-label={t('today.list.lastPage')}
              disabled={page >= pageCount - 1}
              onClick={() => setPageIndex(pageCount - 1)}
              className={pagerBtn}
            >
              <Icon name={`chevrons-${fwd}`} className='size-3.5 shrink-0 bg-ink' />
            </button>
          </div>
        </div>
      </nav>
    </div>
  )
}
