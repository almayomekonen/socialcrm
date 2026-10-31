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
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey, Translator } from '@/lib/i18n/translate'
import { leadStatusFormLabel } from '@/lib/leads/statusStyles'

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
 * Display labels for the stored option VALUES (same mapping as the desktop
 * `clientForm`). The form submits the stored value unchanged; Hebrew passes the
 * exact option lists it always passed.
 */
const GENDER_KEY: Record<string, MessageKey> = { 'זכר': 'leads.form.genderOption.male', 'נקבה': 'leads.form.genderOption.female' }
const SOURCE_KEY: Record<string, MessageKey> = {
  'ידני': 'leads.form.sourceOption.manual',
  'אתר': 'leads.form.sourceOption.website',
  'המלצה': 'leads.form.sourceOption.referral',
  'ייבוא': 'leads.form.sourceOption.import',
  'אחר': 'leads.form.sourceOption.misc',
}
function formOptions(t: Translator) {
  if (t.locale === 'he') return { gender: genderOpt, source: leadSourceCreateOpt, status: STATUS_OPTIONS }
  const label = (values: string[], keys: Record<string, MessageKey>) => values.map((v) => ({ id: v, name: keys[v] ? t(keys[v]) : v }))
  return {
    gender: label(genderOpt, GENDER_KEY),
    source: label(leadSourceCreateOpt, SOURCE_KEY),
    status: STATUS_OPTIONS.map((o) => ({ id: o.id, name: leadStatusFormLabel(o.id, t.locale) as string })),
  }
}

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
  const t = useT()
  const opts = formOptions(t)
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
      if (existingClient) return setErrMsg(t('leads.form.idNumTaken', { name: existingClient.name }))
      if (!isIdNumValid(clientData.idNum)) return setErrMsg(t('leads.form.idNumInvalid'))
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
      <BottomSheet open={open} onClose={onClose} title={t('leads.empty.addLead')} titleId='lead-form-mobile-title' dismissOnScrim={false} translated>
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
          <SubscriptionExpiredState mode='panel' source='create_lead' feature={t('leads.form.expired')} translated />
        ) : (
        <form aria-label={t('leads.empty.addLead')} className='flex flex-col gap-3' onSubmit={onSubmit}>
          <input type='hidden' name='userId' value={user.id} />
          <input type='hidden' name='lead' value='true' />

          <Input name='firstName' lbl={t('leads.form.firstName')} className={FIELD} autoComplete='given-name' onBlur={onContactBlur} />
          <Input name='lastName' lbl={t('leads.form.lastName')} className={FIELD} autoComplete='family-name' onBlur={onContactBlur} />
          <Input
            name='phone'
            lbl={t('leads.form.phone')}
            type='tel'
            className={FIELD}
            required={false}
            autoComplete='tel'
            onBlur={onContactBlur}
          />
          <Input
            name='email'
            lbl={t('leads.form.email')}
            type='email'
            className={FIELD}
            required={false}
            autoComplete='email'
            onBlur={onContactBlur}
          />

          <details className='rounded-lg border border-gray-200'>
            <summary className='flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-medium text-gray-700 [&::-webkit-details-marker]:hidden'>
              {t('leads.form.moreInfo')}
            </summary>
            <div className='flex flex-col gap-3 px-3 pb-3'>
              <Select lbl={t('leads.form.gender')} name='gender' options={opts.gender} required={false} className={FIELD} />
              <Input name='birthDate' lbl={t('leads.form.birthDate')} type='date' className={FIELD} required={false} />
              <Select
                name='leadSource'
                lbl={t('leads.form.leadSource')}
                options={opts.source}
                defaultValue='ידני'
                required={false}
                className={FIELD}
              />
              <Select
                name='status'
                lbl={t('leads.form.status')}
                options={opts.status}
                defaultValue='new'
                required={false}
                className={FIELD}
              />
              <Input
                name='idNum'
                type='number'
                lbl={t('leads.form.idNum')}
                className={FIELD}
                required={false}
                onBlur={onContactBlur}
              />
              <Input
                name='secPhone'
                lbl={t('leads.form.secPhone')}
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
            {saving ? t('leads.mobile.form.saving') : t('leads.empty.addLead')}
          </button>
        </form>
        )}
      </BottomSheet>
      <QuotaPaywallMobile state={paywall} onClose={() => setPaywall(null)} />
    </>
  )
}
