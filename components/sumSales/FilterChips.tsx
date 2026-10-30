'use client'
import { formatDate } from '@/lib/dates'
import { ToolTip } from '../../lib/Tooltip'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { withAdminDefaultDateRange, withoutDateRange } from '@/lib/filter/adminDefaultDateRange'
import type { Roles } from '@/types/roles'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'
import type { UiLocale } from '@/lib/i18n/config'
import { formatLeadDate } from '@/lib/leads/leadDate'
import {
  dateRangeLabel,
  dealActionLabel,
  dealBranchLabel,
  dealCompanyLabel,
  dealProductLabel,
  dealProductTypeLabel,
  dealStatusLabel,
} from '@/lib/deals/labels'

/**
 * The active filter as chips. Each chip is identified by its `id` (removing it
 * deletes `keysToRemove` from the URL JSON, exactly as before); stored values
 * (date ranges, statuses, branches…) are labelled for display only, names are data.
 */
type Chip = { id: string; label: MessageKey; getValues: (f: any) => string[]; keysToRemove: string[] }

function chips(locale: UiLocale, on: string): Chip[] {
  const day = (v: string) => (locale === 'he' ? formatDate(v) : v ? formatLeadDate(locale, v) : '')
  const list = (label: (v: unknown, l?: UiLocale) => string) => (vals: string[] | undefined) => (vals || []).map((v) => label(v, locale))
  return [
    {
      id: 'offerDate',
      label: 'deals.filter.chips.offerDate',
      getValues: (f) => {
        if (!f?.dateRange) return []
        if (f.dateRange === 'מותאם אישית') return [`${day(f.start)} - ${day(f.end)}`]
        return [dateRangeLabel(f.dateRange, locale)]
      },
      keysToRemove: ['dateRange', 'start', 'end'],
    },
    {
      id: 'closeDate',
      label: 'deals.filter.chips.closeDate',
      getValues: (f) => {
        if (!f?.saleDtRange) return []
        if (f.saleDtRange === 'מותאם אישית') return [`${day(f.saleDtStart)} - ${day(f.saleDtEnd)}`]
        return [dateRangeLabel(f.saleDtRange, locale)]
      },
      keysToRemove: ['saleDtRange', 'saleDtStart', 'saleDtEnd'],
    },
    { id: 'action', label: 'deals.filter.chips.action', getValues: (f) => (f?.action ? [dealActionLabel(f.action, locale)] : []), keysToRemove: ['action'] },
    { id: 'branch', label: 'deals.filter.chips.branch', getValues: (f) => (f?.branch ? [dealBranchLabel(f.branch, locale)] : []), keysToRemove: ['branch', 'prdct', 'prdctType'] },
    { id: 'products', label: 'deals.filter.chips.products', getValues: (f) => list(dealProductLabel)(f?.prdct), keysToRemove: ['prdct'] },
    { id: 'productTypes', label: 'deals.filter.chips.productTypes', getValues: (f) => list(dealProductTypeLabel)(f?.prdctType), keysToRemove: ['prdctType'] },
    { id: 'companies', label: 'deals.filter.chips.companies', getValues: (f) => list(dealCompanyLabel)(f?.company), keysToRemove: ['company'] },
    { id: 'status', label: 'deals.filter.chips.status', getValues: (f) => list(dealStatusLabel)(f?.status), keysToRemove: ['status'] },
    {
      id: 'leads',
      label: 'deals.filter.chips.leads',
      getValues: (f) => f?.clientNames || [],
      keysToRemove: ['clientNames', 'clientIds'],
    },
    { id: 'reps', label: 'deals.filter.chips.reps', getValues: (f) => f?.userNames || [], keysToRemove: ['userNames', 'userIds'] },
    { id: 'teams', label: 'deals.filter.chips.teams', getValues: (f) => f?.teamNames || [], keysToRemove: ['teamNames', 'teamIds'] },
    { id: 'handlers', label: 'deals.filter.chips.handlers', getValues: (f) => f?.handlerNames || [], keysToRemove: ['handlerNames', 'handlerIds'] },
    { id: 'replaceOnly', label: 'deals.filter.chips.replaceOnly', getValues: (f) => (f?.replace ? [on] : []), keysToRemove: ['replace'] },
    { id: 'collabOnly', label: 'deals.filter.chips.collabOnly', getValues: (f) => (f?.isCollab ? [on] : []), keysToRemove: ['isCollab'] },
  ]
}

/** Chips that always show their single value instead of a count + tooltip. */
const ONE_VALUE = ['branch', 'action']

export function FilterChips({ filter: urlFilter, role }: { filter: any; role?: Roles }) {
  const router = useRouter()
  // Show the filter the server applies, including an admin's default month.
  const filter = withAdminDefaultDateRange(urlFilter ?? {}, role)
  const t = useT()
  const all = chips(t.locale, t('deals.filter.chips.on'))

  const activeFilters = all
    .map((chip) => ({
      ...chip,
      values: chip.getValues(filter),
    }))
    .filter((chip) => chip.values.length > 0)

  if (activeFilters.length === 0) {
    return null
  }

  function handleRemoveFilter(id: string) {
    const chip = all.find((c) => c.id === id)
    if (!chip) return

    let tmp = { ...filter }
    if (id === 'offerDate') tmp = withoutDateRange(tmp, role)
    else chip.keysToRemove.forEach((key) => delete tmp[key])
    router.replace(`?filter=${JSON.stringify(tmp)}`)
  }

  return (
    <div className='flex gap-0'>
      {activeFilters.length > 0 && <p className='text-sm font-semibold'>{t('deals.filter.chips.active')}</p>}

      <div className='flex gap-1 flex-wrap px-2'>
        {activeFilters.map(({ id, label, values }) => (
          <div className=' relative flex  gap-1 bg-gray-200/70 text-sm pl-2 pr-3 py-1 rounded-full' key={id}>
            {ONE_VALUE.includes(id) ? (
              <span>{values[0]}</span>
            ) : (
              <ToolTip
                pos='bottom'
                lbl={
                  <>
                    {values.slice(0, 8).map((value) => (
                      <p key={value}>{value}</p>
                    ))}
                    {values.length > 8 && <p className='text-gray-400'>{t('deals.filter.chips.more', { count: String(values.length - 8) })}</p>}
                  </>
                }
              >
                {t(label)} {values.length > 1 ? `(${values.length})` : ''}
              </ToolTip>
            )}
            <Btn
              variant='sign'
              size='icon'
              aria-label={t('deals.filter.chips.remove', { label: t(label) })}
              className='bg-gray-100 absolute -left-1 border  border-gray-300 -top-1 rounded-full size-3.5 shadow-1 flex justify-center'
              icon='xmark'
              iconClassName='size-2.5'
              onClick={() => handleRemoveFilter(id)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
