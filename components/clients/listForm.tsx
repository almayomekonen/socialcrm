import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import { getFormData2 } from '@/lib/form/funcs'
import Title from '@/lib/Title'
import { deleteLeadList, upsertLeadList } from '../../actions/clients'
import { useUser } from '@/lib/hooksNEvents'
import { useProps } from '@/lib/hooksNEvents'
import { MultiSelectSearch } from '@/lib/form/MultiSelectSearch'
import { toast } from '@/lib/toast'

export default function ListForm() {
  const user = useUser()
  const { clients, params, clientLists } = useProps()
  const selectedList = clientLists.find((list) => list.id === Number(params.listId))

  async function onSubmit(e) {
    const data = getFormData2(e) as any
    if (!data?.clientIds || data.clientIds.length === 0) return toast('error', 'יש לבחור לידים')

    data.id = selectedList?.id

    await upsertLeadList(user.id, data)
    toast('success')
  }

  return (
    <div popover='auto' id='listForm' className='pop min-w-96 overflow-hidden'>
      <form onSubmit={onSubmit}>
        <div className='flex justify-between items-center'>
          <Title lbl={selectedList ? 'עריכת רשימה' : 'יצירת רשימה חדשה'} />
          {selectedList && <Btn variant='outline' size='icon' icon='trash' onClick={() => deleteLeadList(selectedList.id)} />}
        </div>

        <div className='py-4'>
          <Input name='title' lbl='שם הרשימה' className='mb-2' defaultValue={selectedList?.title} />
          <MultiSelectSearch
            name='clientIds'
            options={clients}
            placeholder='חיפוש'
            lbl='בחר לידים'
            selected={selectedList?.clientIds}
            key={Math.random()}
          />
        </div>

        <Btn lbl='שמירה' className='w-full' />
      </form>
    </div>
  )
}
