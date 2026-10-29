import { addSavedFilters } from '@/actions/filter'
import { redirect, usePathname } from 'next/navigation'
import { clearPersistedFilter, filterSectionForPath } from '@/lib/filter/activeFilter'
import { Btn } from '@/lib/btns/Btn'
import { Input, Select } from '@/lib/form'
import Title from '@/lib/Title'
import { toast } from '@/lib/toast'
import { FilterChips } from '@/components/sumSales/FilterChips'
import { getFormData2 } from '@/lib/form/funcs'
import { useT } from '@/lib/i18n/I18nProvider'
import { dealActionLabel } from '@/lib/deals/labels'

export default function FilterBtn({ user, filter }) {
  const t = useT()
  const pathname = usePathname()
  // Reset also forgets the remembered filter — of THIS section only.
  const section = filterSectionForPath(pathname)
  const onReset = () => section && user?.id && clearPersistedFilter(section, user.id)
  const tmp = Array.isArray(user?.savedFilters) ? user?.savedFilters : []

  const savedFilters = [
    {
      name: t('deals.filter.editSaved'),
      href: '/settings/self_edit?tab=filters',
    },
    ...tmp,

    {
      name: dealActionLabel('הצטרפות', t.locale),
      href: `?filter={"action":"הצטרפות"}`,
    },
    {
      name: t('deals.filter.favorites'),
      href: '?isFav=true',
    },
  ]

  return (
    <div className='flex gap-0 '>
      <FilterChips filter={filter} />
      <div className=' d flex gap-0 ms-2'>
        <Btn lbl={t('deals.filter.button')} popoverTarget='filterPop' icon='filter' className='rounded-e-none gap-4 px-6 ' />
        <Btn
          variant='outline'
          size='icon'
          icon='eraser'
          aria-label={t('deals.filter.clear')}
          href='?'
          scroll={false}
          onClick={onReset}
          className='rounded-s-none  rounded-e-none shadow-none'
        />
        <Select
          placeholder={t('deals.filter.saved')}
          id='savedFilters'
          options={savedFilters}
          val='href'
          show='name'
          onChange={(e) => redirect(e.target.value as any)}
          className='rounded-s-none rounded-e-none w-8 border-s-0  border-gray-200'
          style={{ backgroundSize: '17px', backgroundPosition: 'center' }}
        />
        <Btn
          variant='outline'
          size='icon'
          icon='plus'
          className='rounded-s-none border-s-0 shadow-none'
          title={t('deals.filter.add')}
          popoverTarget='savefilterPop'
        />
      </div>

      <SaveFilterPop user={user} />
    </div>
  )
}

function SaveFilterPop({ user }) {
  const t = useT()
  async function saveFilter(e) {
    toast('loading')
    const data = getFormData2(e) as any
    data.href = window.location.search

    await addSavedFilters({ data, id: user.id })
    toast('success', t('deals.filter.savedToast'))
  }

  return (
    <div className='pop' popover='auto' id='savefilterPop'>
      <form className='grid gap-4' onSubmit={saveFilter}>
        <Title lbl={t('deals.filter.add')} />
        <Input name='name' lbl={t('deals.filter.name')} />
        <Btn lbl={t('deals.filter.save')} icon='floppy-disk' />
      </form>
    </div>
  )
}
