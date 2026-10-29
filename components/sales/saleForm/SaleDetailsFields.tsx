'use client'

import { leadSources } from '@/types/lists'
import Collab from './Collab'
import { userType } from '@/types/types'
import { Btn } from '@/lib/btns/Btn'
import { getUserDefault } from './funcs'
import { DealsView } from '@/types/db/tables'
import { Input, Select } from '@/lib/form'
import { SelectSearch } from '@/lib/form/SelectSearch'

/**
 * The deal form's rep / collaboration and sale-detail fields. Hidden in the
 * SocialCRM simplified flow, but mounted so their defaults submit with the form.
 */
export default function SaleDetailsFields({
  user,
  officeGotPerm,
  allUsers,
  allReps,
  allRepsWithExt,
  curSale,
  share,
  setShare,
  isAsignUser,
  setIsAsignUser,
  otherSource,
  setOtherSource,
}: {
  user: any
  officeGotPerm: userType[]
  allUsers: any[]
  allReps: any[]
  allRepsWithExt: any[]
  curSale?: DealsView
  share: boolean
  setShare: (v: boolean) => void
  isAsignUser: boolean
  setIsAsignUser: (v: boolean) => void
  otherSource: any
  setOtherSource: (v: boolean) => void
}) {
  // SECTION: Users Details — hidden for SocialCRM simplified flow. Inputs stay mounted so defaults submit.
  return (
    <section className='hidden'>
      <div className='my-6 flex gap-3 items-end'>
        {share ? (
          <>
            <Collab
              officeGotPerm={officeGotPerm}
              allRepsWithExt={allRepsWithExt}
              allReps={allReps}
              user={user}
              curSale={curSale}
            />
            <div>
              <Btn
                href='/settings/self_edit?tab=ext_users'
                variant='outline'
                size='small'
                lbl='הוספת שותף חיצוני'
                type='button'
                className=' h-7 text-xs mb-1'
              />
              <Btn lbl='בטל שת"פ' icon='trash' onClick={() => setShare(false)} variant='outline' type='button' />
            </div>
          </>
        ) : (
          <>
            <SelectSearch
              name='users.userId'
              options={user.role === 'OFFICE' ? officeGotPerm : allReps}
              placeholder='חיפוש נציג...'
              lbl='נציג'
              className='w-52'
              selected={getUserDefault(curSale, user, officeGotPerm)}
            />
            <Btn lbl='שת"פ' icon='plus' onClick={() => setShare(true)} variant='outline' type='button' />
          </>
        )}
      </div>

      {/* SECTION: Sale Details */}
      <div className='grid grid-cols-3 items-end gap-4 mb-8 mobile:gap-4 mobile:grid'>
        <div>
          <p className='lbl mb-1'>סוג עסקה</p>
          <Select
            name='action'
            options={['מכירה', 'הצטרפות']}
            className='mobile:w-full'
            onChange={(e) => setIsAsignUser(e.target.value === 'הצטרפות')}
            value={isAsignUser ? 'הצטרפות' : 'מכירה'}
          />
        </div>
        <Input
          lbl='תאריך פנייה'
          name='offrDt'
          type='date'
          className='mobile:w-full'
          defaultValue={curSale?.offrDt || (new Date() as any)}
        />
        <SelectSearch name='handlerId' options={allUsers} lbl='אחראי עסקה' selected={curSale?.handlerId || user?.id} />
        <section>
          <div className='flex gap-2 justify-between'>
            <p className='mb-1 ms-1 lbl'>מקור</p>
            <label className='mb-1 ms-1 flex gap-2 cursor-pointer'>
              <input
                type='checkbox'
                onChange={() => {
                  setOtherSource(!otherSource)
                }}
                className='size-3 accent-solid'
                checked={otherSource || false}
              />
              <p className='lbl'>אחר</p>
            </label>
          </div>
          <div className='inline-flex items-center gap-1 rounded-md border border-gray-200 w-auto'>
            {otherSource ? (
              <Input
                name='leadSource'
                placeholder='הקלד מקור אחר'
                className='w-52 h-10 border-0'
                defaultValue={curSale?.leadSource}
              />
            ) : (
              <Select
                name='leadSource'
                options={leadSources}
                placeholder='בחירת מקור'
                required={false}
                className='w-52 border-0'
                defaultValue={curSale?.leadSource}
              />
            )}
          </div>
        </section>
      </div>
    </section>
  )
}
