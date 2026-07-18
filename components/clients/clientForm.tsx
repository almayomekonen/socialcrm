'use client'

import { Input, Select } from '@/lib/form'
import { genderOpt, leadSourceCreateOpt } from '@/types/lists'
import { useProps } from '@/lib/hooksNEvents'
import { isExtOffice } from '@/types/roles'
import { useUser } from '@/lib/hooksNEvents'
import { SelectSearch } from '@/lib/form/SelectSearch'
import AccordionItem from '@/lib/AccordionItem'

export default function ClientForm({
  data,
  prefix = '',
  onContactBlur,
}: {
  data?: any
  prefix?: string
  onContactBlur?: (name: string, value: string) => void
}) {
  const user = useUser()
  if (!user) return null
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
                lbl='בעל הליד'
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
            <Input name='firstName' lbl='שם פרטי' defaultValue={data?.firstName} onBlur={handleBlur} />
          </div>
          <div className='flex-3 min-w-0'>
            <Input name='lastName' lbl='שם משפחה' defaultValue={data?.lastName} onBlur={handleBlur} />
          </div>
          <div className='flex-2 min-w-0'>
            <Select lbl='מין' name='gender' options={genderOpt} defaultValue={data?.gender} required={false} />
          </div>
        </div>

        {/* Row 2 — contact. Mobile stays one of the widest; date of birth is the narrow column. */}
        <div className='flex w-full gap-3'>
          <div className='flex-3 min-w-0'>
            <Input
              name='phone'
              lbl='טלפון נייד'
              type='tel'
              defaultValue={data?.phone}
              required={false}
              onBlur={handleBlur}
            />
          </div>
          <div className='flex-3 min-w-0'>
            <Input name='email' lbl='מייל' type='email' defaultValue={data?.email} required={false} onBlur={handleBlur} />
          </div>
          <div className='flex-2 min-w-0'>
            <Input name='birthDate' lbl='תאריך לידה' type='date' defaultValue={data?.birthDate} required={false} />
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
              <Input name='leadSource' lbl='מקור הליד' defaultValue={data?.leadSource} required={false} />
            ) : (
              <Select
                name='leadSource'
                lbl='מקור הליד'
                options={leadSourceCreateOpt}
                defaultValue='ידני'
                required={false}
              />
            )}
          </div>

          {hasMultipleUsers && (
            <div className='flex-3 min-w-0'>
              <Select
                lbl='אחראי נוסף (לא חובה)'
                name='handlerId'
                options={handlers}
                defaultValue={data?.handlerId ?? user.id}
                required={false}
              />
            </div>
          )}
          <div className='flex-3 min-w-0'>
            <Select
              options={[
                { name: 'חדש', id: 'new' },
                { name: 'בטיפול', id: 'contacted' },
                { name: 'מתעניין', id: 'interested' },
                { name: 'נסגר', id: 'closed' },
                { name: 'לא רלוונטי', id: 'lost' },
              ]}
              name='status'
              lbl='סטטוס'
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
                    name: 'לקוח',
                    id: false,
                  },
                  {
                    name: 'ליד',
                    id: true,
                  },
                ]}
                name='lead'
                lbl='סטטוס'
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
          <AccordionItem title='מידע נוסף' bodyClass='p-4 pt-1'>
            <div className='flex w-full gap-3'>
              <div className='flex-3 min-w-0'>
                <Input
                  name='idNum'
                  type='number'
                  lbl="מס' תעודת זהות"
                  defaultValue={data?.idNum}
                  required={false}
                  onBlur={handleBlur}
                />
              </div>
              <div className='flex-3 min-w-0'>
                <Input
                  name='secPhone'
                  lbl='טלפון נוסף'
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
