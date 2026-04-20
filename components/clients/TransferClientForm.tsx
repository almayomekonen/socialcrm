import { Btn } from '@/lib/btns/Btn'
import Title from '@/lib/Title'
import { getFormData2 } from '@/lib/form/funcs'
import { api } from '@/lib/funcs'
import { useState } from 'react'
import { transferLeadToRep } from '@/actions/clients'
import { useProps } from '@/lib/hooksNEvents'
import { SelectSearch } from '@/lib/form/SelectSearch'
import ConfirmPop from '@/lib/modals/ConfirmPop'

export default function TransferClientForm({ client }) {
  let { users } = useProps()
  const [userName, setUserName] = useState('')
  const [pending, setPending] = useState<{ userId: any } | null>(null)

  function onSubmit(e) {
    e.preventDefault()
    const data = getFormData2(e)
    setPending({ userId: data.userId })
  }

  async function onConfirm() {
    if (!pending) return
    await api(transferLeadToRep, [client.id, pending.userId])
    setPending(null)
  }

  return (
    <div>
      <Title lbl={`העברת ליד מהנציג ${client.userName}`} className='mb-6' />
      <form id='transferClientForm' onSubmit={onSubmit}>
        <SelectSearch name='userId' lbl='בחר נציג' options={users} onSelectOpt={(user) => setUserName(user.name)} />
        <Btn lbl='שמירה' className='w-full mt-8' icon='floppy-disk' />
      </form>
      <ConfirmPop
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={onConfirm}
        msg={`האם להעביר ליד ${client.name} לנציג ${userName} ?`}
      />
    </div>
  )
}
