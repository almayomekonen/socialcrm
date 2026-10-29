import { redirect } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import ListForm from './listForm'
import { useProps } from '@/lib/hooksNEvents'
import { useT } from '@/lib/i18n/I18nProvider'

export default function SelectClientLists() {
  const t = useT()
  const { clientLists, params } = useProps()

  const listIdParam = params.listId || ''

  return (
    <div className='flex gap-0'>
      <Select
        placeholder={t('leads.toolbar.lists')}
        options={clientLists.map((list) => ({
          id: list.id,
          title: `${list.title} (${list.clientIds.length})`,
        }))}
        value={listIdParam}
        val='id'
        show='title'
        onChange={(e) => redirect(`?listId=${e.target.value}`)}
        className={`rounded-e-none ${listIdParam ? 'bg-teal-50' : 'bg-white'}`}
      />

      {listIdParam && (
        <Btn
          title={t('leads.toolbar.editList')}
          variant='outline'
          size='icon'
          className='rounded-none border-s-0 shadow-none'
          icon='pen'
          popoverTarget='listForm'
        />
      )}

      <Btn
        title={t('leads.toolbar.newList')}
        variant='outline'
        size='icon'
        className='rounded-s-none border-s-0 shadow-none'
        icon='plus'
        popoverTarget='listForm'
      />

      <ListForm />
    </div>
  )
}
