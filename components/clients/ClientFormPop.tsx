'use client'
import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { getLeadByIdNum, upsertLead } from '../../actions/clients'
import Title from '@/lib/Title'
import { useUser } from '@/lib/hooksNEvents'
import ClientForm from './clientForm'
import { getFormData2 } from '@/lib/form/funcs'
import { api, isIdNumValid } from '@/lib/funcs'
import ConfirmPop from '@/lib/modals/ConfirmPop'

export default function ClientFormPop({ client, onClose }: { client?: any; onClose?: () => void }) {
  const user = useUser()
  const [errMsg, setErrMsg] = useState<string | null>(null)
  if (!user) return null

  async function onSubmit(e) {
    const clientData = getFormData2(e) as any
    if (!clientData.userId) clientData.userId = user.id

    if (!client?.id && clientData.idNum) {
      const existingClient = await getLeadByIdNum(clientData.idNum)
      if (existingClient) return setErrMsg(`תעודת זהות זו משוייכת לליד ${existingClient.name}`)
    }

    if (clientData.idNum && !isIdNumValid(clientData.idNum)) return setErrMsg('תעודת זהות לא תקינה')

    const res = await api(upsertLead, [user.id, clientData, client?.id])
    if (res.err) return setErrMsg(res.msg)

    onClose?.()
  }

  return (
    <div>
      <Title lbl={client?.id ? 'עריכת ליד' : 'הוספת ליד'} className='mb-6' />
      <form id='clientForm' onSubmit={onSubmit}>
        <ClientForm key={Math.random()} data={client} />
        <Btn lbl='שמירה' className='w-full mt-8' icon='floppy-disk' />
      </form>
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
      />
    </div>
  )
}
