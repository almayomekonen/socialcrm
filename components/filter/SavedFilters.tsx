import { redirect } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { Input, Select } from '@/lib/form'
import Title from '../../lib/Title'
import { getFormData2 } from '@/lib/form/funcs'
import { addSavedFilters } from '../../actions/filter'
import { toast } from '@/lib/toast'

export default function SaveFilters({ user }) {
  const tmp = Array.isArray(user?.savedFilters) ? user?.savedFilters : []

  const savedFilters = [
    ...tmp,

    {
      name: 'הצטרפות',
      href: `/?filter={"action":"הצטרפות"}`,
    },
    {
      name: 'מועדפים',
      href: '/?isFav=true',
    },
    {
      name: 'עריכה',
      href: '/settings/self_edit?tab=filters',
    },
  ]

  return (
    <div className='flex gap-0'>
      <Select
        options={savedFilters}
        val='href'
        show='name'
        onChange={(e) => redirect(e.target.value as any)}
        className='rounded-e-none w-10'
      />
      <Btn
        variant='outline'
        size='icon'
        icon='plus'
        className='rounded-s-none border-s-0 shadow-none'
        title='הוספת סינון'
        popoverTarget='savefilterPop'
      />

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
