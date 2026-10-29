'use client'

import { formatDateAge } from '@/lib/dates'
import { toast } from '@/lib/toast'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey, Translator } from '@/lib/i18n/translate'
import { formatLeadDate } from '@/lib/leads/leadDate'
import { usePathname, useRouter } from 'next/navigation'
import { Select } from '@/lib/form'
import Icon from '@/lib/Icon'
import CloseDealBtn from './CloseDealBtn'

/** Stored gender values (Hebrew, the form's option values) → display label. Anything else is shown as stored. */
const GENDER_KEY: Record<string, MessageKey> = {
  'זכר': 'leads.form.genderOption.male',
  'נקבה': 'leads.form.genderOption.female',
}

/** Birth date and age. Hebrew keeps its exact legacy output (`formatDateAge`). */
function birthDateAge(t: Translator, birthDate) {
  if (!birthDate || t.locale === 'he') return formatDateAge(birthDate)
  return `${formatLeadDate(t.locale, birthDate)} (${new Date().getFullYear() - birthDate.getFullYear()})`
}

export default function ClientHeader({ client, user, handlerName, family, clientId, formProps }) {
  const t = useT()
  const region = useRegionAttrs()
  const router = useRouter()
  const pathname = usePathname()
  const genderKey = client.gender ? GENDER_KEY[client.gender] : undefined

  function copyEmail() {
    navigator.clipboard.writeText(client.email)
    toast('success', t('leadDetail.header.copied', { text: client.email }))
  }

  return (
    <div className='bg-[#e8ecf4] px-12 full-bleed  ' {...region}>
      <div className='overflow-x-auto '>
        <div className='flex items-center gap-8 py-2.5 justify-between font-medium min-w-max'>
          <div className='flex items-center gap-4 '>
            {/* Keep the name on ONE line. The header row is `min-w-max` inside an
                `overflow-x-auto` scroller, so it never gives the name flexible
                space to shrink into — a width bound is required to force ellipsis
                truncation instead of wrapping. `max-w` (not a fixed width) lets
                short names use their natural width; longer names truncate. Full
                name stays available on hover via the existing `title` pattern. */}
            <p title={client.name} className='font-bold max-w-[14rem] truncate'>
              {client.name}
            </p>
            {family.length > 0 && (
              <Select
                className='bg-softy h-8 w-40 rounded-full border-solid font-semibold'
                options={family}
                defaultValue={clientId}
                onChange={(e) => {
                  if (e.target.value) {
                    router.push(`${pathname.replace(/\/clients\/[^\/]+/, `/clients/${e.target.value}`)}` as any)
                  }
                }}
              />
            )}
          </div>

          <p>{birthDateAge(t, client.birthDate)}</p>
          <p>{genderKey ? t(genderKey) : client.gender}</p>

          {client.email && (
            <div
              onClick={copyEmail}
              className='bg-softy cursor-pointer rounded-xl px-4 flex items-center gap-2'
            >
              <Icon name='copy' className='size-4 bg-solid' />
              {client.email}
            </div>
          )}

          <p>{client.phone}</p>
          {handlerName && (
            <div className='flex items-end gap-2'>
              <h2>{t('leadDetail.header.handler')}</h2>
              <p className='font-bold'>{handlerName}</p>
            </div>
          )}

          {formProps && <CloseDealBtn clientId={clientId} clientName={client.name} formProps={formProps} />}

          {/* <Icon name='ellipsis-vertical' className='size-8' /> */}
        </div>
      </div>
    </div>
  )
}
