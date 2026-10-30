'use client'

import dynamic from 'next/dynamic'
import { redirect } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { SelectSearch } from '@/lib/form/SelectSearch'
import ShowColumns from '@/lib/table/ShowColumns'
import type { ConfigT } from '@/lib/table'
import { getDealDataToExport } from '@/actions/salesTbl'
import { searchContacts } from '@/actions/clients'
import { useT } from '@/lib/i18n/I18nProvider'
import GroupAction from './GroupAction'

const ExportTable = dynamic(() => import('@/lib/table/export'), { ssr: false })

/** Search a deal by its lead: every date / action / status, that lead only (stored filter values). */
function getSelectedClient(client) {
  redirect(
    ('?filter=' +
      JSON.stringify({
        clientIds: [client.id],
        clientNames: [client.details],
        dateRange: 'כל התאריכים',
        action: 'הכל',
        status: ['הכל'],
      })) as any,
  )
}

/** The deals table toolbar: search, group actions, bulk delete, columns, export (stored Hebrew headers), import, add. */
export default function SalesTableToolbar({
  fillHeight,
  isFav,
  selectedCount,
  rowCount,
  onBulkDelete,
  config,
  columns,
  onImport,
  onAdd,
}: {
  fillHeight?: boolean
  isFav: any
  selectedCount: number
  rowCount: number
  onBulkDelete: () => void
  config: ConfigT
  /** The STORED columns: the export keeps their Hebrew labels. */
  columns: any[]
  onImport: () => void
  onAdd?: () => void
}) {
  const t = useT()
  return (
    <div className={`flex justify-between gap-4 items-end ${fillHeight ? 'shrink-0' : ''}`}>
      <div className='flex gap-3 items-end mb-2'>
        <SelectSearch placeholder={t('deals.table.search')} show='details' searchFunc={searchContacts} onSelectOpt={getSelectedClient} />
        <GroupAction isFav={isFav} />
      </div>

      <div className='flex gap-2 items-end mb-2'>
        {selectedCount > 0 && (
          <Btn
            variant='destructive'
            icon='trash'
            lbl={
              selectedCount === rowCount
                ? t('deals.table.deleteAll', { count: String(selectedCount) })
                : t('deals.table.deleteSelected', { count: String(selectedCount) })
            }
            onClick={onBulkDelete}
          />
        )}
        <ShowColumns config={config} />
        <ExportTable dataToFetch={getDealDataToExport} columns={columns} />
        {/* Icon-only in the tablet band (like the export buttons beside it), so the label does not squeeze the column picker. */}
        <Btn
          lbl={t('deals.table.import')}
          aria-label={t('deals.table.import')}
          title={t('deals.table.import')}
          icon='file-import'
          variant='outline'
          className='tablet:size-10 tablet:shrink-0 tablet:p-0 tablet:[&>span]:hidden'
          onClick={onImport}
        />
        {onAdd && <Btn lbl={t('deals.table.add')} icon='plus' onClick={onAdd} className='ms-4' />}
      </div>
    </div>
  )
}
