'use client'
import { Select } from '@/lib/form'
import { getFormData2 } from '@/lib/form/funcs'
import { Btn } from '@/lib/btns/Btn'
import { api } from '@/lib/funcs'
import { updateUserInfoData } from '@/actions/usersNteams'
import { useT } from '@/lib/i18n/I18nProvider'

export default function LogoutMinutesForm({ user }) {
  const t = useT()
  async function onSubmit(e) {
    const data = getFormData2(e)
    api(updateUserInfoData, [data, user.id])
  }

  return (
    <form onSubmit={onSubmit}>
      <Select
        options={[
          // The stored value is the number of minutes; only the wording follows the interface.
          ...[5, 10, 20, 30].map((id) => ({ name: t('settings.account.security.minutes', { count: id }), id })),
        ]}
        defaultValue={user.logoutMinutes}
        name='logoutMinutes'
      />
      <Btn lbl={t('settings.account.security.save')} className='w-full mt-4' />
    </form>
  )
}
