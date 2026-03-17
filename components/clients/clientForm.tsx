'use client'

import { Input, Select } from '@/lib/form'
import { familyStatusOpt, genderOpt } from '@/types/lists'
import { useProps } from '@/lib/hooksNEvents'
import { isExtOffice } from '@/types/roles'
import { useUser } from '@/lib/hooksNEvents'
import { SelectSearch } from '@/lib/form/SelectSearch'

export default function ClientForm({ data, prefix = '' }) {
  const user = useUser()
  const { handlers, users } = useProps()
  console.log('the client is', data)
  return (
    <div className='max-w-4xl' data-prefix={prefix}>
      <div className='flex  items-start flex-col gap-4'>
        {!data?.id && (
          <SelectSearch
            name='userId'
            lbl='נציג'
            className='w-52'
            options={users || []}
            selected={!isExtOffice(user.role) ? user.id : null}
          />
        )}
        <div className='flex'>
          <Input name='firstName' lbl='שם פרטי' defaultValue={data?.firstName} />
          <Input name='lastName' lbl='שם משפחה' defaultValue={data?.lastName} />
          <Input name='idNum' type='number' lbl="מס' תעודת זהות" defaultValue={data?.idNum} />
          <Input name='idNumDate' type='date' lbl='תאריך הנפקת ת.ז' defaultValue={data?.idNumDate} required={false} />
        </div>
        <div className='flex'>
          <Input name='passportNum' type='number' lbl='מספר דרכון' defaultValue={data?.passportNum} required={false} />
          <Input name='licenseNum' type='number' lbl='מספר רישיון נהיגה' defaultValue={data?.licenseNum} required={false} />
        </div>
        <div className='flex'>
          <Input name='birthDate' lbl='תאריך לידה' type='date' defaultValue={data?.birthDate} required={false} />
          <Select lbl='מין' name='gender' options={genderOpt} defaultValue={data?.gender} required={false} />
          <Select
            lbl='מצב משפחתי'
            name='familyStatus'
            options={familyStatusOpt}
            defaultValue={data?.familyStatus}
            required={false}
          />
        </div>

        <div className='flex'>
          <Input name='phone' lbl='טלפון נייד' type='tel' defaultValue={data?.phone} required={false} />
          <Input name='secPhone' lbl='טלפון נוסף' type='tel' defaultValue={data?.secPhone} required={false} />
          <Input name='email' lbl='מייל' type='email' defaultValue={data?.email} required={false} />
        </div>

        <div className='flex'>
          <Select options={['1', '2', '3']} name='rank' lbl='סיווג' defaultValue={data?.rank?.toString()} required={false} />
          <Input name='leadSource' lbl='מקור הליד' defaultValue={data?.leadSource} required={false} />

          <Select
            lbl='אחראי'
            name='handlerId'
            options={handlers}
            defaultValue={data?.handlerId ?? user.id}
            required={false}
          />
          <Select
            options={[
              {
                name: 'לא פעיל',
                id: false,
              },
              {
                name: 'פעיל',
                id: true,
              },
            ]}
            name='status'
            lbl='פעילות'
            defaultValue={data?.status ?? true}
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
            defaultValue={data?.lead}
            required={false}
          />
        </div>
      </div>
    </div>
  )
}
