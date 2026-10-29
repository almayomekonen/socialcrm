'use client'

import { Input, Select } from '@/lib/form'
import { genderOpt, leadSourceCreateOpt } from '@/types/lists'
import { useProps } from '@/lib/hooksNEvents'
import { isExtOffice } from '@/types/roles'
import { useUser } from '@/lib/hooksNEvents'
import { SelectSearch } from '@/lib/form/SelectSearch'
import AccordionItem from '@/lib/AccordionItem'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'
import { leadStatusFormLabel } from '@/lib/leads/statusStyles'

/**
 * Display labels for the stored option VALUES. The form submits the stored
 * Hebrew value unchanged (`types/lists.ts`); only the visible text follows the
 * interface language. Hebrew renders exactly the stored value, as before.
 */
const GENDER_KEY: Record<string, MessageKey> = {
  'זכר': 'leads.form.genderOption.male',
  'נקבה': 'leads.form.genderOption.female',
}
const SOURCE_KEY: Record<string, MessageKey> = {
  'ידני': 'leads.form.sourceOption.manual',
  'אתר': 'leads.form.sourceOption.website',
  'המלצה': 'leads.form.sourceOption.referral',
  'ייבוא': 'leads.form.sourceOption.import',
  'אחר': 'leads.form.sourceOption.misc',
}
const FORM_STATUS_CODES = ['new', 'contacted', 'interested', 'closed', 'lost'] as const

export default function ClientForm({
  data,
  prefix = '',
  onContactBlur,
}: {
  data?: any
  prefix?: string
  onContactBlur?: (name: string, value: string) => void
}) {
  const t = useT()
  const user = useUser()
  if (!user) return null
  const optionsFor = (values: string[], keys: Record<string, MessageKey>) =>
    values.map((v) => ({ id: v, name: keys[v] ? t(keys[v]) : v }))
  const { handlers, users } = useProps()
  const hasMultipleUsers = false
  const isEdit = !!data?.id
  const handleBlur = onContactBlur
    ? (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => onContactBlur(e.target.name, e.target.value)
    : undefined
  return (
    <div className='max-w-4xl' data-prefix={prefix}>
      <div className='flex items-start flex-col gap-3'>
        {!isEdit && (
          <>
            {hasMultipleUsers ? (
              <SelectSearch
                name='userId'
                lbl={t('leads.form.owner')}
                className='w-52'
                options={users}
                selected={!isExtOffice(user.role) ? user.id : null}
              />
            ) : (
              <input type='hidden' name='userId' value={user.id} />
            )}
          </>
        )}

        {/* Row 1 — identity. Names are the primary fields; gender is the narrow column. */}
        <div className='flex w-full gap-3'>
          <div className='flex-3 min-w-0'>
            <Input name='firstName' lbl={t('leads.form.firstName')} defaultValue={data?.firstName} onBlur={handleBlur} />
          </div>
          <div className='flex-3 min-w-0'>
            <Input name='lastName' lbl={t('leads.form.lastName')} defaultValue={data?.lastName} onBlur={handleBlur} />
          </div>
          <div className='flex-2 min-w-0'>
            <Select lbl={t('leads.form.gender')} name='gender' options={optionsFor(genderOpt, GENDER_KEY)} defaultValue={data?.gender} required={false} />
          </div>
        </div>

        {/* Row 2 — contact. Mobile stays one of the widest; date of birth is the narrow column. */}
        <div className='flex w-full gap-3'>
          <div className='flex-3 min-w-0'>
            <Input
              name='phone'
              lbl={t('leads.form.phone')}
              type='tel'
              defaultValue={data?.phone}
              required={false}
              onBlur={handleBlur}
            />
          </div>
          <div className='flex-3 min-w-0'>
            <Input name='email' lbl={t('leads.form.email')} type='email' defaultValue={data?.email} required={false} onBlur={handleBlur} />
          </div>
          <div className='flex-2 min-w-0'>
            <Input name='birthDate' lbl={t('leads.form.birthDate')} type='date' defaultValue={data?.birthDate} required={false} />
          </div>
        </div>

        {/* Row 3 — classification. */}
        <div className='flex w-full gap-3'>
          <div className='flex-3 min-w-0'>
            {/*
              Create: structured Select (no free text). Edit keeps the free-text input so
              existing out-of-list values (e.g. webhook "facebook:..." or legacy sources)
              are preserved and never silently overwritten.
            */}
            {isEdit ? (
              <Input name='leadSource' lbl={t('leads.form.leadSource')} defaultValue={data?.leadSource} required={false} />
            ) : (
              <Select
                name='leadSource'
                lbl={t('leads.form.leadSource')}
                options={optionsFor(leadSourceCreateOpt, SOURCE_KEY)}
                defaultValue='ידני'
                required={false}
              />
            )}
          </div>

          {hasMultipleUsers && (
            <div className='flex-3 min-w-0'>
              <Select
                lbl={t('leads.form.handler')}
                name='handlerId'
                options={handlers}
                defaultValue={data?.handlerId ?? user.id}
                required={false}
              />
            </div>
          )}
          <div className='flex-3 min-w-0'>
            <Select
              options={FORM_STATUS_CODES.map((code) => ({ name: leadStatusFormLabel(code, t.locale), id: code }))}
              name='status'
              lbl={t('leads.form.status')}
              defaultValue={data?.status ?? 'new'}
              required={false}
            />
          </div>
          {/* Lead/Client selector shown only on Edit. On Create every record is a lead. */}
          {isEdit && (
            <div className='flex-2 min-w-0'>
              <Select
                options={[
                  {
                    name: t('leads.table.customer'),
                    id: false,
                  },
                  {
                    name: t('leads.form.kindLead'),
                    id: true,
                  },
                ]}
                name='lead'
                lbl={t('leads.form.status')}
                defaultValue={data?.lead ?? true}
                required={false}
              />
            </div>
          )}
        </div>

        {/* Create: submit lead=true internally (same value the removed selector defaulted to). */}
        {!isEdit && <input type='hidden' name='lead' value='true' />}

        {/* Additional, rarely-needed fields — same accordion in Create and Edit. Native <details>
            keeps them mounted, so existing values display when expanded, and entered values are
            preserved and still submit when collapsed. */}
        <div className='accordion w-full'>
          <AccordionItem title={t('leads.form.moreInfo')} bodyClass='p-4 pt-1'>
            <div className='flex w-full gap-3'>
              <div className='flex-3 min-w-0'>
                <Input
                  name='idNum'
                  type='number'
                  lbl={t('leads.form.idNum')}
                  defaultValue={data?.idNum}
                  required={false}
                  onBlur={handleBlur}
                />
              </div>
              <div className='flex-3 min-w-0'>
                <Input
                  name='secPhone'
                  lbl={t('leads.form.secPhone')}
                  type='tel'
                  defaultValue={data?.secPhone}
                  required={false}
                  onBlur={handleBlur}
                />
              </div>
            </div>
          </AccordionItem>
        </div>
      </div>
    </div>
  )
}
