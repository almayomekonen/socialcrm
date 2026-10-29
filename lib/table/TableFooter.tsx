import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import { useRouter } from 'next/navigation'
import { useProps } from '@/lib/hooksNEvents'
import { Route } from 'next'
import { useT } from '@/lib/i18n/I18nProvider'
import { dirFor } from '@/lib/i18n/config'

export default function TableFooter() {
  const t = useT()
  // Arrows point the way the page reads: "previous" toward the start of the line.
  const rtl = dirFor(t.locale) === 'rtl'
  const { params, tableLength, count } = useProps()
  let { filter, listId, pageNum = 1, tableLimit = 100 } = params

  const router = useRouter()
  function onPageChange(num, limit = tableLimit) {
    let strLink = `?pageNum=${num}&tableLimit=${limit}`
    if (listId) strLink += `&listId=${listId}`
    if (filter) strLink += `&filter=${filter}`

    router.push(strLink as Route, { scroll: false })
  }

  function onQnttChange(e) {
    const limit = e.target.value
    onPageChange(1, limit)
  }

  return (
    <div className='flex items-center justify-between p-4 bg-white border border-t-0 rounded-b-md w-full'>
      <div className='flex items-center gap-4'>
        <Select options={['100', '500', '1000']} onChange={onQnttChange} defaultValue={tableLimit} />
        <p>{count ? t('common.table.recordsOf', { count: String(tableLength), total: String(count) }) : t('common.table.records', { count: String(tableLength) })}</p>
      </div>
      <div className='flex items-center gap-4'>
        <Btn
          lbl={t('common.table.prev')}
          variant='outline'
          icon={rtl ? 'angle-right' : 'angle-left'}
          size='small'
          onClick={() => onPageChange(Number(pageNum) - 1)}
          disabled={pageNum <= 1}
        />
        <p className='font-semibold'>{pageNum || 1}</p>
        <Btn
          lbl={t('common.table.next')}
          variant='outline'
          icon={rtl ? 'angle-left' : 'angle-right'}
          size='small'
          onClick={() => onPageChange(Number(pageNum) + 1)}
          disabled={tableLength < tableLimit}
          className='flex-row-reverse'
        />
      </div>
    </div>
  )
}
