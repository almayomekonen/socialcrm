import { useRef } from 'react'
import Icon from '@/lib/Icon'
import { userType } from '@/types/types'
import { getUserDefault } from './SaleForm'
import { SelectSearch } from '@/lib/form/SelectSearch'

type Props = {
  allReps: any[]
  allRepsWithExt: any[]
  user: any
  curSale?: any
  officeGotPerm: userType[]
}

export default function Collab({ allReps, allRepsWithExt, user, curSale, officeGotPerm }: Props) {
  const prcnt1Ref = useRef(null)
  const prcnt2Ref = useRef(null)

  console.log('cursale', curSale)

  return (
    <main className='flex gap-4'>
      <section>
        <div className='inline-flex items-end'>
          <SelectSearch
            lbl='נציג 1'
            name='users.userId'
            options={user.role === 'OFFICE' ? officeGotPerm : allReps}
            placeholder='חיפוש נציג...'
            className='w-[168px]'
            inputCls='rounded-l-none border-l-0'
            selected={getUserDefault(curSale, user, officeGotPerm)}
          />
          <div className='bg-gray-100 flex gap-0 p-1 rounded-l'>
            <Icon name='percent' className='bg-gray-500 size-4' />

            <input
              className='w-11 outline-none h-8 ps-2'
              type='number'
              required
              name='users.userPrcnt'
              min='0'
              max='100'
              placeholder='50'
              id='userPrcnt'
              ref={prcnt1Ref}
              defaultValue={curSale?.userPrcnts?.[0] && curSale?.userPrcnts?.length > 1 ? curSale?.userPrcnts?.[0] : 50}
              onChange={(e) => {
                const val = Number(e.target.value)
                prcnt1Ref.current.value = val
                prcnt2Ref.current.value = 100 - val
              }}
            />
          </div>
        </div>
      </section>

      <section>
        <div className='inline-flex items-end'>
          <SelectSearch
            lbl='נציג 2'
            name='users.user2Id'
            options={allRepsWithExt}
            placeholder='חיפוש נציג...'
            className='w-[168px] border-0'
            inputCls='rounded-l-none border-l-0'
            selected={curSale?.userIds?.[1] || allRepsWithExt[0]?.id}
          />

          <div className='bg-gray-100 flex gap-0 p-1  rounded-l'>
            <Icon name='percent' className='bg-gray-500 size-4' />

            <input
              className='w-11 outline-none h-8 ps-2'
              type='number'
              name='users.user2Prcnt'
              min='0'
              max='100'
              placeholder='50'
              id='user2Prcnt'
              defaultValue={curSale?.userPrcnts?.[1] ?? 50}
              ref={prcnt2Ref}
              onChange={(e) => {
                const val = Number(e.target.value)
                prcnt1Ref.current.value = 100 - val
                prcnt2Ref.current.value = val
              }}
            />
          </div>
        </div>
      </section>
    </main>
  )
}
