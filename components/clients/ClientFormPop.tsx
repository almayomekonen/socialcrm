'use client'
import { useEffect, useRef, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { getLeadByIdNum, upsertLead } from '../../actions/clients'
import { findDuplicateLeads } from '../../actions/leadDuplicates'
import type { DuplicateMatch } from '@/lib/leads/duplicateMatch'
import Title from '@/lib/Title'
import { useUser } from '@/lib/hooksNEvents'
import ClientForm from './clientForm'
import DuplicateLeadBanner from './DuplicateLeadBanner'
import { getFormData2 } from '@/lib/form/funcs'
import { api, isIdNumValid } from '@/lib/funcs'
import { toast } from '@/lib/toast'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import QuotaPaywallModal, { QuotaPaywallState } from '@/components/quota/QuotaPaywallModal'

const DUPLICATE_CHECK_DEBOUNCE_MS = 400
const CONTACT_FIELDS = ['firstName', 'lastName', 'idNum', 'phone', 'secPhone', 'email'] as const

export default function ClientFormPop({
  client,
  onClose,
  onCreated,
}: {
  client?: any
  onClose?: () => void
  onCreated?: (leadId: number) => void
}) {
  const expired = useAccessDenied()
  const user = useUser()
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [paywall, setPaywall] = useState<QuotaPaywallState | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([])
  const [dupDismissed, setDupDismissed] = useState(false)

  const contactRef = useRef<Record<string, string>>({
    firstName: client?.firstName ?? '',
    lastName: client?.lastName ?? '',
    idNum: client?.idNum ?? '',
    phone: client?.phone ?? '',
    secPhone: client?.secPhone ?? '',
    email: client?.email ?? '',
  })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reqRef = useRef(0)

  useEffect(() => () => debounceRef.current && clearTimeout(debounceRef.current), [])

  function runDuplicateCheck() {
    const c = contactRef.current
    const token = ++reqRef.current
    findDuplicateLeads({
      phone: c.phone,
      secPhone: c.secPhone,
      email: c.email,
      idNum: c.idNum,
      firstName: c.firstName,
      lastName: c.lastName,
      excludeId: client?.id ?? null,
    })
      .then((res) => {
        if (token !== reqRef.current) return
        setDuplicates(res)
        setDupDismissed(false)
      })
      .catch(() => {})
  }

  function onContactBlur(name: string, value: string) {
    if (!CONTACT_FIELDS.includes(name as (typeof CONTACT_FIELDS)[number])) return
    contactRef.current[name] = value
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(runDuplicateCheck, DUPLICATE_CHECK_DEBOUNCE_MS)
  }

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
      {!dupDismissed && duplicates.length > 0 && (
        <DuplicateLeadBanner matches={duplicates} onDismiss={() => setDupDismissed(true)} />
      )}
      {/*
        Refuse BEFORE submitting rather than after. The server already refuses —
        correctly — but that refusal arrived as a raw "Minified React error #441"
        dialog, in English, inside an RTL Hebrew product. Intercepting here means
        the customer is told what is actually wrong, in their language, with the
        way to fix it, and the doomed request is never sent.
      */}
      {expired ? (
        <div className='mt-2'>
          <SubscriptionExpiredState mode='panel' source='create_lead' feature='הוספת לידים מושהית.' />
        </div>
      ) : (
        <form id='clientForm' onSubmit={onSubmit}>
          <ClientForm key={client?.id ?? 'new'} data={client} onContactBlur={onContactBlur} />
          <Btn lbl='שמירה' className='w-full mt-8' icon='floppy-disk' />
        </form>
      )}
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
