import { Btn } from '@/lib/btns/Btn'
import Title from '@/lib/Title'
import { getFormData2 } from '@/lib/form/funcs'
import { api } from '@/lib/funcs'
import { useState } from 'react'
import { transferClientToUser } from '@/actions/clients'
import { useProps } from '@/lib/hooksNEvents'
import { SelectSearch } from '@/lib/form/SelectSearch'

export default function TransferClientForm({ client }) {
  let { users } = useProps()
  const [userName, setUserName] = useState('')

  async function onSubmit(e) {
    const data = getFormData2(e)
    if (!confirm(`האם להעביר לקוח ${client.name} לנציג ${userName} ?`)) return
    await api(transferClientToUser, [client.id, data.userId])
  }

  return (
    <div>
      <Title lbl={`העברת לקוח מהנציג ${client.userName}`} className='mb-6' />
      <form id='transferClientForm' onSubmit={onSubmit}>
        <SelectSearch name='userId' lbl='בחר נציג' options={users} onSelectOpt={(user) => setUserName(user.name)} />
        <Btn lbl='שמירה' className='w-full mt-8' icon='floppy-disk' />
      </form>
    </div>
  )
}
