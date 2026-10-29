'use client'

import { leadSources } from '@/types/lists'
import Collab from './Collab'
import { userType } from '@/types/types'
import { Btn } from '@/lib/btns/Btn'
import { getUserDefault } from './funcs'
import { DealsView } from '@/types/db/tables'
import { Input, Select } from '@/lib/form'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { useT } from '@/lib/i18n/I18nProvider'
import { dealActionLabel, dealLeadSourceLabel, labelledOptions } from '@/lib/deals/labels'

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
  const t = useT()
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
                lbl={t('deals.form.addPartner')}
                type='button'
                className=' h-7 text-xs mb-1'
              />
              <Btn lbl={t('deals.form.cancelCollab')} icon='trash' onClick={() => setShare(false)} variant='outline' type='button' />
            </div>
          </>
        ) : (
          <>
            <SelectSearch
              name='users.userId'
              options={user.role === 'OFFICE' ? officeGotPerm : allReps}
              placeholder={t('deals.form.repSearch')}
              lbl={t('deals.form.rep')}
              className='w-52'
              selected={getUserDefault(curSale, user, officeGotPerm)}
            />
            <Btn lbl={t('deals.form.collab')} icon='plus' onClick={() => setShare(true)} variant='outline' type='button' />
          </>
        )}
      </div>

      {/* SECTION: Sale Details */}
      <div className='grid grid-cols-3 items-end gap-4 mb-8 mobile:gap-4 mobile:grid'>
        <div>
          <p className='lbl mb-1'>{t('deals.form.saleType')}</p>
          <Select
            name='action'
            options={labelledOptions(['מכירה', 'הצטרפות'], dealActionLabel, t.locale)}
            className='mobile:w-full'
            onChange={(e) => setIsAsignUser(e.target.value === 'הצטרפות')}
            value={isAsignUser ? 'הצטרפות' : 'מכירה'}
          />
        </div>
        <Input
          lbl={t('deals.form.offerDate')}
          name='offrDt'
          type='date'
          className='mobile:w-full'
          defaultValue={curSale?.offrDt || (new Date() as any)}
        />
        <SelectSearch name='handlerId' options={allUsers} lbl={t('deals.form.handler')} selected={curSale?.handlerId || user?.id} />
        <section>
          <div className='flex gap-2 justify-between'>
            <p className='mb-1 ms-1 lbl'>{t('deals.form.source')}</p>
            <label className='mb-1 ms-1 flex gap-2 cursor-pointer'>
              <input
                type='checkbox'
                onChange={() => {
                  setOtherSource(!otherSource)
                }}
                className='size-3 accent-solid'
                checked={otherSource || false}
              />
              <p className='lbl'>{t('deals.form.otherSource')}</p>
            </label>
          </div>
          <div className='inline-flex items-center gap-1 rounded-md border border-gray-200 w-auto'>
            {otherSource ? (
              <Input
                name='leadSource'
                placeholder={t('deals.form.otherSourcePlaceholder')}
                className='w-52 h-10 border-0'
                defaultValue={curSale?.leadSource}
              />
            ) : (
              <Select
                name='leadSource'
                options={labelledOptions(leadSources, dealLeadSourceLabel, t.locale)}
                placeholder={t('deals.form.sourcePlaceholder')}
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
