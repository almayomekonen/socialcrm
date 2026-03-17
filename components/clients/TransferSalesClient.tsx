import { Btn } from '@/lib/btns/Btn'
import Title from '@/lib/Title'
import { getFormData2 } from '@/lib/form/funcs'
import { useProps } from '@/lib/hooksNEvents'
import { api } from '@/lib/funcs'
import { transferSalesToClient } from '../../actions/clients'
import { useState } from 'react'
import { SelectSearch } from '@/lib/form/SelectSearch'

export default function TransferSalesClient({ client }) {
  const { clients } = useProps()
  const [clientName, setClientName] = useState('')

  async function onSubmit(e) {
    const data = getFormData2(e)
    if (!confirm(`האם להעביר מכירות של לקוח ${client.name} ללקוח ${clientName} ?`)) return
    await api(transferSalesToClient, [client.id, data.clientId])
  }

  return (
    <div>
      <Title lbl={`העברת מכירות מהלקוח ${client.name}`} className='mb-6' />
      <form id='transferSalesForm' onSubmit={onSubmit}>
        <SelectSearch
          name='clientId'
          placeholder='חיפוש לקוח..'
          options={clients}
          onSelectOpt={(client) => setClientName(client.name)}
        />
        <Btn lbl='שמירה' className='w-full mt-8' icon='floppy-disk' />
      </form>
    </div>
  )
}
