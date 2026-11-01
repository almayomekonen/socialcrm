import { Suspense } from 'react'
import { getExtUsersCreatedByUser, getFullUser, getUsers } from '@/db/usersNTeams'
import { Roles } from '@/types/roles'
import { getPerms } from '@/db/filter'
import SelfEdit from '@/components/settings/SelfEdit'
import { getUser } from '@/db/auth'
import { getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export default async function SelfEditPage() {
  const user = await getUser()
  if (user.role === Roles.OFFICE) {
    const { locale } = await getUiLocaleState(user)
    return (
      <div {...regionAttrs(locale)} className='px-8 py-4 m-4 ms-0 rounded font-semibold bg-red-950 text-white w-fit'>
        {translatorFor(locale)('settings.account.denied')}
      </div>
    )
  }

  const curUser = await getFullUser({ id: user.id })
  const users = await getUsers({ withOfficeUsers: true })
  const extUsers = await getExtUsersCreatedByUser(user.id)
  const allUsers = await getUsers({ withExtUsers: true })
  const gavePerm = (await getPerms(user)).gavePermUsers

  return (
    <Suspense fallback={null}>
      <SelfEdit curUser={curUser} users={users} extUsers={extUsers} allUsers={allUsers} user={user} gavePerm={gavePerm} />
    </Suspense>
  )
}
