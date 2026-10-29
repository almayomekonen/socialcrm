'use client'

import type { ReactNode } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { Select } from '@/lib/form'
import { searchContacts, searchLeads } from '@/actions/clients'
import ShowColumns from '@/lib/table/ShowColumns'
import { ConfigT } from '@/lib/table'
import { SelectClientGrpActions } from '../funcs'
import SelectClientLists from '../SelectClientLists'
import { suggestionName } from './useLeadSearch'
import { useT } from '@/lib/i18n/I18nProvider'

export type SortMode = 'priority' | 'newest'

/** Search box, result count, bulk actions, sort, columns, lists, export and "new". */
export default function LeadsToolbar({
  leads,
  user,
  fillHeight,
  config,
  search,
  searchTerm,
  resultCount,
  selectedCount,
  visibleCount,
  assigning,
  deleting,
  onBulkAssign,
  onBulkDelete,
  sortMode,
  onSortChange,
  exportControl,
  onAdd,
}: {
  leads: boolean
  user: any
  fillHeight: boolean
  config: ConfigT
  search: { boxTerm: string; onSearchChange: (text: string) => void; submitText: (text: string) => void; pickSuggestion: (client: any) => void }
  searchTerm: string
  resultCount: number
  selectedCount: number
  visibleCount: number
  assigning: boolean
  deleting: boolean
  onBulkAssign: () => void
  onBulkDelete: () => void
  sortMode: SortMode
  onSortChange: (mode: SortMode) => void
  /** The export control, rendered by the table that owns the export data. */
  exportControl: ReactNode
  onAdd: () => void
}) {
  const t = useT()
  const n = String(selectedCount)
  return (
    <div className={`flex justify-between gap-2 mb-2 items-end ${fillHeight ? 'shrink-0' : ''}`}>
      <div className='flex gap-0 items-end'>
        <SelectSearch
          options={[]}
          show='details'
          selected={null}
          val='id'
          inputCls='w-52 rounded-e-none'
          searchFunc={leads ? searchLeads : searchContacts}
          onSelectOpt={search.pickSuggestion}
          onSubmitText={search.submitText}
          onSearchChange={search.onSearchChange}
          selectText={suggestionName}
          initShow={search.boxTerm}
        />
        <Btn variant='outline' size='icon' icon='eraser' aria-label={t('leads.toolbar.clearSearch')} href='?' scroll={false} className='rounded-s-none border-s-0' />
        {/* The status tabs count the FILTERED set, so under a search their
            zeros need a number beside them that says why. Only while a
            search is active — an unfiltered workspace needs no caption. */}
        {searchTerm && (
          <p aria-live='polite' className='ms-2 self-center text-[12px] tabular-nums whitespace-nowrap text-gray-500'>
            {t('leads.toolbar.results', { count: String(resultCount) })}
          </p>
        )}
      </div>

      <div className='flex gap-2 items-end'>
        {/* Assign sits before delete: it is the routine action, and the
            destructive one should not be the first button reached. */}
        {selectedCount > 0 && (
          <Btn
            variant='outline'
            icon={assigning ? 'spinner' : 'user-check'}
            iconClassName={assigning ? 'animate-spin' : ''}
            disabled={assigning}
            lbl={assigning ? t('leads.toolbar.assigning', { n }) : t('leads.toolbar.assign', { n })}
            onClick={onBulkAssign}
          />
        )}
        {selectedCount > 0 && (
          <Btn
            variant='destructive'
            icon={deleting ? 'spinner' : 'trash'}
            iconClassName={deleting ? 'animate-spin' : ''}
            disabled={deleting}
            lbl={
              deleting
                ? t('leads.toolbar.deleting', { n })
                : leads
                  ? selectedCount === visibleCount
                    ? t('leads.toolbar.deleteAll', { n })
                    : t('leads.toolbar.delete', { n })
                  : t('leads.toolbar.deleteCustomers', { n })
            }
            onClick={onBulkDelete}
          />
        )}
        <Select
          options={[
            { id: 'priority', name: t('leads.toolbar.sortPriority') },
            { id: 'newest', name: t('leads.toolbar.sortNewest') },
          ]}
          value={sortMode}
          onChange={(e) => onSortChange(e.target.value as SortMode)}
          required={false}
          aria-label={t('leads.toolbar.sortAria')}
        />
        <ShowColumns config={config} />
        <SelectClientGrpActions user={user} />
        <SelectClientLists />
        {exportControl}
        <Btn data-edu={leads ? 'leads-add' : undefined} lbl={leads ? t('leads.toolbar.newLead') : t('leads.toolbar.newCustomer')} icon='plus' onClick={onAdd} />
      </div>
    </div>
  )
}
