'use client'
import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { getLeadByIdNum, upsertLead } from '../../actions/clients'
import Title from '@/lib/Title'
import { useUser } from '@/lib/hooksNEvents'
import ClientForm from './clientForm'
import { getFormData2 } from '@/lib/form/funcs'
import { api, isIdNumValid } from '@/lib/funcs'
import { toast } from '@/lib/toast'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import QuotaPaywallModal, { QuotaPaywallState } from '@/components/quota/QuotaPaywallModal'

export default function ClientFormPop({
  client,
  onClose,
  onCreated,
}: {
  client?: any
  onClose?: () => void
  /** Called after a successful upsert with the lead's id. Lets callers
   *  (e.g. the billing flow) navigate into the new lead's workspace
   *  without re-fetching. Fires on both insert and update. */
  onCreated?: (leadId: number) => void
}) {
  const user = useUser()
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [paywall, setPaywall] = useState<QuotaPaywallState | null>(null)
  if (!user) return null

  async function onSubmit(e) {
    const clientData = getFormData2(e) as any
    if (!clientData.userId) clientData.userId = user.id

    if (!client?.id && clientData.idNum) {
      const existingClient = await getLeadByIdNum(clientData.idNum)
      if (existingClient) return setErrMsg(`תעודת זהות זו משוייכת לליד ${existingClient.name}`)
    }

    if (clientData.idNum && !isIdNumValid(clientData.idNum)) return setErrMsg('תעודת זהות לא תקינה')

    const res = await api(upsertLead, [user.id, clientData, client?.id], undefined, undefined, { silentSuccess: true })
    if (res?.error === 'quota_exceeded') {
      return setPaywall({ current: res.current, limit: res.limit, attempted: res.attempted })
    }
    if (res.err) return setErrMsg(res.msg)

    toast('success')
    if (onCreated && res?.id) onCreated(res.id)
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
      <QuotaPaywallModal state={paywall} onClose={() => setPaywall(null)} />
    </div>
  )
}
