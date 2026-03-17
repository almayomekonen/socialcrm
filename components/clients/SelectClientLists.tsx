import { redirect } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import ListForm from './listForm'
import { useProps } from '@/lib/hooksNEvents'

export default function SelectClientLists() {
  const { clientLists, params } = useProps()

  const listIdParam = params.listId || ''

  return (
    <div className='flex gap-0'>
      <Select
        placeholder='רשימות'
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
          title='ערוך רשימה'
          variant='outline'
          size='icon'
          className='rounded-none border-s-0 shadow-none'
          icon='pen'
          popoverTarget='listForm'
        />
      )}

      <Btn
        title='רשימה חדשה'
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
