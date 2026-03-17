import { Btn } from '@/lib/btns/Btn'
import { getClientByIdNum, upsertClient } from '../../actions/clients'
import Title from '@/lib/Title'
import { useUser } from '@/lib/hooksNEvents'
import ClientForm from './clientForm'
import { getFormData2 } from '@/lib/form/funcs'
import { api, isIdNumValid } from '@/lib/funcs'

export default function ClientFormPop({ client }) {
  const user = useUser()

  async function onSubmit(e) {
    const clientData = getFormData2(e) as any
    if (!clientData.userId && !client?.id) return alert('יש לבחור נציג')

    if (!client?.id) {
      const existingClient = await getClientByIdNum(clientData.idNum)
      if (existingClient) return alert(`תעודת זהות זו משוייכת ללקוח ${existingClient.name}`)
    }

    if (!isIdNumValid(clientData.idNum)) return alert('תעודת זהות לא תקינה')

    const res = await api(upsertClient, [user.id, clientData, client?.id])
    if (res.err) return alert(res.msg)
  }

  return (
    <div>
      <Title lbl={client?.id ? 'עריכת לקוח' : 'הוספת לקוח'} className='mb-6' />
      <form id='clientForm' onSubmit={onSubmit}>
        <ClientForm key={Math.random()} data={client} />
        <Btn lbl='שמירה' className='w-full mt-8' icon='floppy-disk' />
      </form>
    </div>
  )
}
