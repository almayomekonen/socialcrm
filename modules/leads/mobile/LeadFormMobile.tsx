'use client'

import { useEffect, useRef, useState } from 'react'
import { Input, Select } from '@/lib/form'
import { getFormData2 } from '@/lib/form/funcs'
import { genderOpt, leadSourceCreateOpt } from '@/types/lists'
import { useUser } from '@/lib/hooksNEvents'
import { api, isIdNumValid } from '@/lib/funcs'
import { toast } from '@/lib/toast'
import { getLeadByIdNum, upsertLead } from '@/actions/clients'
import { findDuplicateLeads } from '@/actions/leadDuplicates'
import type { DuplicateMatch } from '@/lib/leads/duplicateMatch'
import type { QuotaPaywallState } from '@/components/quota/QuotaPaywallModal'
import DuplicateLeadBanner from '@/components/clients/DuplicateLeadBanner'
import BottomSheet from '@/components/mobile/BottomSheet'
import QuotaPaywallMobile from './QuotaPaywallMobile'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'

const DUPLICATE_CHECK_DEBOUNCE_MS = 400
const CONTACT_FIELDS = ['firstName', 'lastName', 'idNum', 'phone', 'secPhone', 'email'] as const
const FIELD = 'h-11 text-base'

const STATUS_OPTIONS = [
  { name: 'חדש', id: 'new' },
  { name: 'בטיפול', id: 'contacted' },
  { name: 'מתעניין', id: 'interested' },
  { name: 'נסגר', id: 'closed' },
  { name: 'לא רלוונטי', id: 'lost' },
]

/**
 * Phone add-lead sheet. Same action, validation, duplicates, and quota as
 * `ClientFormPop` — vertical stack instead of the desktop 3-row flex layout.
 */
export default function LeadFormMobile({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated?: (leadId: number) => void
}) {
  const user = useUser()
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [paywall, setPaywall] = useState<QuotaPaywallState | null>(null)
  const expired = useAccessDenied()
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([])
  const [dupDismissed, setDupDismissed] = useState(false)
  const [saving, setSaving] = useState(false)

  const contactRef = useRef<Record<string, string>>({
    firstName: '',
    lastName: '',
    idNum: '',
    phone: '',
    secPhone: '',
    email: '',
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
      excludeId: null,
    })
      .then((res) => {
        if (token !== reqRef.current) return
        setDuplicates(res)
        setDupDismissed(false)
      })
      .catch(() => {})
  }

  function onContactBlur(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target
    if (!CONTACT_FIELDS.includes(name as (typeof CONTACT_FIELDS)[number])) return
    contactRef.current[name] = value
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(runDuplicateCheck, DUPLICATE_CHECK_DEBOUNCE_MS)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!user) return
    const clientData = getFormData2(e) as any
    if (!clientData.userId) clientData.userId = user.id
    setErrMsg(null)

    if (clientData.idNum) {
      const existingClient = await getLeadByIdNum(clientData.idNum)
      if (existingClient) return setErrMsg(`תעודת זהות זו משוייכת לליד ${existingClient.name}`)
      if (!isIdNumValid(clientData.idNum)) return setErrMsg('תעודת זהות לא תקינה')
    }

    setSaving(true)
    try {
      const res = await api(upsertLead, [user.id, clientData, undefined], undefined, undefined, { silentSuccess: true })
      if (res?.error === 'quota_exceeded') {
        setPaywall({ current: res.current, limit: res.limit, attempted: res.attempted })
        return
      }
      if (res?.err) {
        setErrMsg(res.msg)
        return
      }
      toast('success')
      if (onCreated && res?.id) onCreated(res.id)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (!user) return null

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title='הוסף ליד' titleId='lead-form-mobile-title' dismissOnScrim={false}>
        {!dupDismissed && duplicates.length > 0 && (
          <DuplicateLeadBanner matches={duplicates} onDismiss={() => setDupDismissed(true)} />
        )}
        {errMsg && (
          <p role='alert' className='mb-3 text-sm text-red-600'>
            {errMsg}
          </p>
        )}
        {/*
          CREATING a lead is Tier 2 (`upsertLead` escalates to
          `requireProductAccess()` on its create branch); EDITING one is Tier 1
          and stays free. The server refuses correctly, but `upsertLead` catches
          that refusal alongside every other failure and returns the generic
          `{ err: true, msg: 'שגיאה בשמירת לקוח' }`, so an expired customer was
          told their lead failed to save rather than that creating leads needs a
          subscription — and was invited to retry something that cannot succeed.

          Refusing here is the pattern desktop already uses (`ClientFormPop`):
          same component, same `source='create_lead'`, same copy. The doomed
          request is never sent, and no new entitlement mechanism is introduced.
        */}
        {expired ? (
          <SubscriptionExpiredState mode='panel' source='create_lead' feature='חידוש המנוי מחזיר את הוספת הלידים.' />
        ) : (
        <form aria-label='הוסף ליד' className='flex flex-col gap-3' onSubmit={onSubmit}>
          <input type='hidden' name='userId' value={user.id} />
          <input type='hidden' name='lead' value='true' />

          <Input name='firstName' lbl='שם פרטי' className={FIELD} autoComplete='given-name' onBlur={onContactBlur} />
          <Input name='lastName' lbl='שם משפחה' className={FIELD} autoComplete='family-name' onBlur={onContactBlur} />
          <Input
            name='phone'
            lbl='טלפון נייד'
            type='tel'
            className={FIELD}
            required={false}
            autoComplete='tel'
            onBlur={onContactBlur}
          />
          <Input
            name='email'
            lbl='מייל'
            type='email'
            className={FIELD}
            required={false}
            autoComplete='email'
            onBlur={onContactBlur}
          />

          <details className='rounded-lg border border-gray-200'>
            <summary className='flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-medium text-gray-700 [&::-webkit-details-marker]:hidden'>
              מידע נוסף
            </summary>
            <div className='flex flex-col gap-3 px-3 pb-3'>
              <Select lbl='מין' name='gender' options={genderOpt} required={false} className={FIELD} />
              <Input name='birthDate' lbl='תאריך לידה' type='date' className={FIELD} required={false} />
              <Select
                name='leadSource'
                lbl='מקור הליד'
                options={leadSourceCreateOpt}
                defaultValue='ידני'
                required={false}
                className={FIELD}
              />
              <Select
                name='status'
                lbl='סטטוס'
                options={STATUS_OPTIONS}
                defaultValue='new'
                required={false}
                className={FIELD}
              />
              <Input
                name='idNum'
                type='number'
                lbl="מס' תעודת זהות"
                className={FIELD}
                required={false}
                onBlur={onContactBlur}
              />
              <Input
                name='secPhone'
                lbl='טלפון נוסף'
                type='tel'
                className={FIELD}
                required={false}
                onBlur={onContactBlur}
              />
            </div>
          </details>

          <button
            type='submit'
            disabled={saving}
            className='press mt-1 flex min-h-12 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            {saving ? 'שומר...' : 'הוסף ליד'}
          </button>
        </form>
        )}
      </BottomSheet>
      <QuotaPaywallMobile state={paywall} onClose={() => setPaywall(null)} />
    </>
  )
}
