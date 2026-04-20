import { Btn } from '@/lib/btns/Btn'
import Title from '@/lib/Title'
import { getFormData2 } from '@/lib/form/funcs'
import { useProps } from '@/lib/hooksNEvents'
import { api } from '@/lib/funcs'
import { transferDealsToLead } from '../../actions/clients'
import { useState } from 'react'
import { SelectSearch } from '@/lib/form/SelectSearch'
import ConfirmPop from '@/lib/modals/ConfirmPop'

export default function TransferSalesClient({ client }) {
  const { clients } = useProps()
  const [clientName, setClientName] = useState('')
  const [pending, setPending] = useState<{ clientId: any } | null>(null)

  function onSubmit(e) {
    e.preventDefault()
    const data = getFormData2(e)
    setPending({ clientId: data.clientId })
  }

  async function onConfirm() {
    if (!pending) return
    await api(transferDealsToLead, [client.id, pending.clientId])
    setPending(null)
  }

  return (
    <div>
      <Title lbl={`העברת עסקאות מהליד ${client.name}`} className='mb-6' />
      <form id='transferSalesForm' onSubmit={onSubmit}>
        <SelectSearch
          name='clientId'
          placeholder='חיפוש ליד..'
          options={clients}
          onSelectOpt={(client) => setClientName(client.name)}
        />
        <Btn lbl='שמירה' className='w-full mt-8' icon='floppy-disk' />
      </form>
      <ConfirmPop
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={onConfirm}
        msg={`האם להעביר עסקאות של ליד ${client.name} לליד ${clientName} ?`}
      />
    </div>
  )
}
