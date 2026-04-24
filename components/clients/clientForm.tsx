'use client'

import { Input, Select } from '@/lib/form'
import { genderOpt } from '@/types/lists'
import { useProps } from '@/lib/hooksNEvents'
import { isExtOffice } from '@/types/roles'
import { useUser } from '@/lib/hooksNEvents'
import { SelectSearch } from '@/lib/form/SelectSearch'

export default function ClientForm({ data, prefix = '' }) {
  const user = useUser()
  if (!user) return null
  const { handlers, users } = useProps()
  const hasMultipleUsers = false
  return (
    <div className='max-w-4xl' data-prefix={prefix}>
      <div className='flex  items-start flex-col gap-4'>
        {!data?.id && (
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
        <div className='flex'>
          <Input name='firstName' lbl='שם פרטי' defaultValue={data?.firstName} />
          <Input name='lastName' lbl='שם משפחה' defaultValue={data?.lastName} />
          <Input name='idNum' type='number' lbl="מס' תעודת זהות" defaultValue={data?.idNum} required={false} />
        </div>
        <div className='flex'>
          <Input name='birthDate' lbl='תאריך לידה' type='date' defaultValue={data?.birthDate} required={false} />
          <Select lbl='מין' name='gender' options={genderOpt} defaultValue={data?.gender} required={false} />
        </div>

        <div className='flex'>
          <Input name='phone' lbl='טלפון נייד' type='tel' defaultValue={data?.phone} required={false} />
          <Input name='secPhone' lbl='טלפון נוסף' type='tel' defaultValue={data?.secPhone} required={false} />
          <Input name='email' lbl='מייל' type='email' defaultValue={data?.email} required={false} />
        </div>

        <div className='flex'>
          <Input name='leadSource' lbl='מקור הליד' defaultValue={data?.leadSource} required={false} />

          {hasMultipleUsers && (
            <Select
              lbl='אחראי נוסף (לא חובה)'
              name='handlerId'
              options={handlers}
              defaultValue={data?.handlerId ?? user.id}
              required={false}
            />
          )}
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
      </div>
    </div>
  )
}
