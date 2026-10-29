'use client'

import { updateGavePerm } from '@/actions/usersNteams'
import DeletePermBtn from './DeletePermBtn'
import { SubmitButton } from '@/lib/btns/SubmitBtn'
import { isAdmin } from '@/types/roles'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { getFormData2 } from '@/lib/form/funcs'
import { useT } from '@/lib/i18n/I18nProvider'

export default function AddAuthUsersComp({ users, user, gavePerm }) {
  const t = useT()
  async function onAction(e) {
    const data = getFormData2(e) as any
    if (data?.permUserId) await updateGavePerm(user.id, data.permUserId)
  }

  return (
    <div className='  w-fit'>
      <div className='mb-4'>
        <p className='text-gray-600 text-sm'>
          {t('settings.account.perms.intro1')} <br /> {t('settings.account.perms.intro2')}
        </p>
      </div>

      <div className='mb-4'>
        <p className='mb-1'>{t('settings.account.perms.allowed')}</p>
        <div className='flex flex-wrap gap-1'>
          {gavePerm.map((gavePermUser) => {
            return (
              <span key={gavePermUser.id} className='inline-flex items-center gap-3 text-sm bg-white border rounded-xl py-1 px-2'>
                <p>{gavePermUser.name}</p>
                <DeletePermBtn curUserId={user.id} removeId={gavePermUser.id} />
              </span>
            )
          })}
        </div>
      </div>

      <form onSubmit={onAction} className='grid gap-4'>
        <SelectSearch name='permUserId' lbl={t('settings.account.perms.pick')} options={users} />

        <SubmitButton lbl={t('settings.account.perms.add')} disabled={isAdmin(user.role)} />
      </form>
    </div>
  )
}
