'use client'
import { Deal } from '@/types/db/tables'
import { useRef, useState } from 'react'
import { getLeadByIdNum, searchContacts, upsertLead } from '@/actions/clients'
import { useUser } from '@/lib/hooksNEvents'
import { Btn } from '@/lib/btns/Btn'
import Title from '@/lib/Title'
import { Input } from '@/lib/form'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { isIdNumValid } from '@/lib/funcs'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import QuotaPaywallModal, { QuotaPaywallState } from '@/components/quota/QuotaPaywallModal'
import { useT } from '@/lib/i18n/I18nProvider'

type Props = {
  curSale?: Deal & { clientData: string }
}

export default function ClientDataForm({ curSale }: Props) {
  console.log('curSale', curSale)
  const t = useT()
  const user = useUser()
  if (!user) return null
  const [client, setClient] = useState(curSale ? { details: curSale?.clientData, id: curSale?.clientId } : null)
  return (
    <div>
      <div className='flex w-full justify-between items-end border-b pb-2 mb-4 mobile:gap-y-2'>
        <div className='flex'>
          <h2 className='text-lg'>{t('deals.form.lead.section')}</h2>
        </div>
      </div>
      <section className='flex items-end'>
        <SelectSearch
          inputCls='w-52'
          key={client?.id}
          lbl={t('deals.form.lead.label')}
          initShow={client?.details}
          selected={client?.id}
          show='details'
          val='id'
          placeholder={t('deals.form.lead.search')}
          name='clientId'
          searchFunc={searchContacts}
        />
        <Btn type='button' icon='plus' variant='outline' lbl={t('deals.form.lead.create')} popoverTarget='clientSaleForm' />
      </section>
      <ClientSaleFormPop user={user} setClient={setClient} />
    </div>
  )
}

function ClientSaleFormPop({ user, setClient }) {
  const t = useT()
  const firstNameRef = useRef(null)
  const lastNameRef = useRef(null)
  const idNumRef = useRef(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [paywall, setPaywall] = useState<QuotaPaywallState | null>(null)

  async function onSubmit() {
    const data = {
      firstName: firstNameRef.current?.value,
      lastName: lastNameRef.current?.value,
      idNum: idNumRef.current?.value,
      userId: user.id,
      handlerId: user.id,
    }

    if (!data.firstName || !data.lastName || !data.idNum) return setErrMsg(t('deals.form.lead.error.missing'))
    if (!isIdNumValid(data.idNum)) return setErrMsg(t('deals.form.lead.error.invalidId'))
    const existingClient = await getLeadByIdNum(data.idNum)
    if (existingClient) return setErrMsg(t('deals.form.lead.error.idTaken', { name: String(existingClient.name) }))

    const res = await upsertLead(user.id, data, null, false)
    if ((res as any)?.error === 'quota_exceeded') {
      return setPaywall({ current: (res as any).current, limit: (res as any).limit, attempted: (res as any).attempted })
    }
    if (res.err) return setErrMsg(res.msg)

    setClient(res)
    // reset form
    document.getElementById('clientSaleForm')?.hidePopover()
    firstNameRef.current!.value = ''
    lastNameRef.current!.value = ''
    idNumRef.current!.value = ''
  }
  return (
    <div id='clientSaleForm' popover='auto' className='pop w-75'>
      <Title lbl={t('deals.form.lead.createTitle')} className='mb-4 w-full' />
      <div className='grid gap-2'>
        <Input name='firstName' ref={firstNameRef} lbl={t('deals.form.lead.firstName')} required={false} />
        <Input name='lastName' ref={lastNameRef} lbl={t('deals.form.lead.lastName')} required={false} />
        <Input type='number' name='idNum' ref={idNumRef} lbl={t('deals.form.lead.idNum')} required={false} />
      </div>
      <Btn type='button' className='mt-4 w-full' lbl={t('deals.form.lead.save')} onClick={onSubmit} icon='floppy-disk' />
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
        translated
      />
      <QuotaPaywallModal state={paywall} onClose={() => setPaywall(null)} />
    </div>
  )
}
