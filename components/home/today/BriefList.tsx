import Link from 'next/link'
import Icon from '@/lib/Icon'
import LeadAvatar from '@/components/ui/lead-avatar'
import type { BriefItem } from '@/lib/today/types'
import { WAIT_STATE_TONE } from './waitTone'
import { badgeOutline, btn, toneIcon } from '@/components/home/dashboard/ui'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

// Presentational (RSC). The rest of the brief as a shadcn data table (dashboard-01)
// — every item, no pagination (INV-15). The wait badge is neutral with a toned
// icon and always carries text (never colour-only).
const iconBtn = `${btn.base} ${btn.ghost} ${btn.icon}`
const th = 'h-10 px-2 text-start align-middle font-medium whitespace-nowrap text-neutral-950'
const td = 'p-2 align-middle'

export default function BriefList({ items, locale = 'he' }: { items: BriefItem[]; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <div className='overflow-hidden rounded-lg border border-neutral-200 bg-white'>
      <div className='w-full overflow-x-auto'>
        <table className='w-full caption-bottom text-sm'>
          <thead className='sticky top-0 z-10 bg-neutral-100'>
            <tr className='border-b border-neutral-200'>
              <th className={`${th} ps-4`}>{t('today.list.colLead')}</th>
              <th className={th}>{t('today.list.colStatus')}</th>
              <th className={th}>{t('today.list.colSource')}</th>
              <th className={th}>{t('today.list.colDetails')}</th>
              <th className={`${th} pe-4 text-end`}>
                <span className='sr-only'>{t('today.list.colActions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const href = it.href ?? `/clients/${it.id}/summary`
              const chip = it.waitingFor ?? it.reason
              const tone = WAIT_STATE_TONE[it.state]
              // Same rule as the mission card: only a real thread link earns the WhatsApp action.
              const openConversation = Boolean(it.conversationId || it.href?.startsWith('/inbox'))
              const details = [it.waitingFor ? it.reason : null, it.windowHint].filter(Boolean).join(' · ')
              return (
                <tr key={it.id} className='border-b border-neutral-200 transition-colors last:border-0 hover:bg-neutral-50'>
                  <td className={`${td} ps-4`}>
                    <div className='flex items-center gap-3'>
                      <LeadAvatar name={it.name} size='sm' fallback={t('today.list.avatarFallback')} />
                      <Link
                        href={href}
                        className='truncate font-medium text-neutral-950 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-neutral-950/15'
                      >
                        {it.name || '—'}
                      </Link>
                    </div>
                  </td>
                  <td className={td}>
                    <span data-tone={tone} className={`${badgeOutline} px-1.5 text-neutral-500 tabular-nums`}>
                      <Icon name='clock' className={`size-3 shrink-0 ${toneIcon[tone]}`} />
                      {chip}
                    </span>
                  </td>
                  <td className={td}>{it.source && <span className={`${badgeOutline} px-1.5 text-neutral-500`}>{it.source}</span>}</td>
                  <td className={`${td} max-w-72 truncate text-neutral-500`}>{details}</td>
                  <td className={`${td} pe-4`}>
                    <div className='flex justify-end gap-1'>
                      {openConversation && (
                        <Link
                          href={href}
                          aria-label={t('today.list.whatsappWith', { name: it.name || t('today.mission.leadFallback') })}
                          className={iconBtn}
                        >
                          <Icon name='whatsapp' type='sol' className='size-4 shrink-0 bg-neutral-500' />
                        </Link>
                      )}
                      {it.phone && (
                        <a
                          href={`tel:${it.phone}`}
                          aria-label={t('today.mission.callName', { name: it.name || t('today.mission.leadFallback') })}
                          className={iconBtn}
                        >
                          <Icon name='phone' className='size-4 shrink-0 bg-neutral-500' />
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
  )
}
