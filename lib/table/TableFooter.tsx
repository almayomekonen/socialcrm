import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import { useRouter } from 'next/navigation'
import { useProps } from '@/lib/hooksNEvents'
import { Route } from 'next'

export default function TableFooter() {
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
    <div className='flex justify-between p-4 bg-white border border-t-0 rounded-b-md'>
      <div className='flex'>
        <Select options={['100', '500', '1000']} onChange={onQnttChange} defaultValue={tableLimit} />
        <p>{`${tableLength} רשומות` + (count ? ` מתוך ${count}` : '')}</p>
      </div>
      <div className='flex gap-4'>
        <Btn
          lbl='הקודם'
          variant='outline'
          icon='angle-right'
          size='small'
          onClick={() => onPageChange(Number(pageNum) - 1)}
          disabled={pageNum <= 1}
        />
        <p className='font-semibold'>{pageNum || 1}</p>
        <Btn
          lbl='הבא'
          variant='outline'
          icon='angle-left'
          size='small'
          onClick={() => onPageChange(Number(pageNum) + 1)}
          disabled={tableLength < tableLimit}
          className='flex-row-reverse'
        />
      </div>
    </div>
  )
}
