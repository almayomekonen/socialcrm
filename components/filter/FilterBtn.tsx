import { addSavedFilters } from '@/actions/filter'
import { redirect } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { Input, Select } from '@/lib/form'
import Title from '@/lib/Title'
import { toast } from '@/lib/toast'
import { FilterChips } from '@/components/sumSales/FilterChips'
import { getFormData2 } from '@/lib/form/funcs'

export default function FilterBtn({ user, filter }) {
  const tmp = Array.isArray(user?.savedFilters) ? user?.savedFilters : []

  const savedFilters = [
    {
      name: 'עריכת סינונים',
      href: '/settings/self_edit?tab=filters',
    },
    ...tmp,

    {
      name: 'הצטרפות',
      href: `?filter={"action":"הצטרפות"}`,
    },
    {
      name: 'מועדפים',
      href: '?isFav=true',
    },
  ]

  return (
    <div className='flex gap-0 '>
      <FilterChips filter={filter} />
      <div className=' d flex gap-0 ms-2'>
        <Btn lbl='סינון' popoverTarget='filterPop' icon='filter' className='rounded-e-none gap-4 px-6 ' />
        <Btn
          variant='outline'
          size='icon'
          icon='eraser'
          href='?'
          scroll={false}
          className='rounded-s-none  rounded-e-none shadow-none'
        />
        <Select
          placeholder='סינונים שמורים:'
          id='savedFilters'
          options={savedFilters}
          val='href'
          show='name'
          onChange={(e) => redirect(e.target.value as any)}
          className='rounded-s-none rounded-e-none w-8 border-s-0  border-gray-300'
          style={{ backgroundSize: '17px', backgroundPosition: 'center' }}
        />
        <Btn
          variant='outline'
          size='icon'
          icon='plus'
          className='rounded-s-none border-s-0 shadow-none'
          title='הוספת סינון'
          popoverTarget='savefilterPop'
        />
      </div>

      <SaveFilterPop user={user} />
    </div>
  )
}

function SaveFilterPop({ user }) {
  async function saveFilter(e) {
    toast('loading')
    const data = getFormData2(e) as any
    data.href = window.location.search

    await addSavedFilters({ data, id: user.id })
    toast('success', 'סינון נשמר בהצלחה')
  }

  return (
    <div className='pop' popover='auto' id='savefilterPop'>
      <form className='grid gap-4' onSubmit={saveFilter}>
        <Title lbl='הוספת סינון' />
        <Input name='name' lbl='שם הסינון' />
        <Btn lbl='שמירה' icon='floppy-disk' />
      </form>
    </div>
  )
}
