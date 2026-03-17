import { getUser } from '@/db/auth'
import SettingsLink from '@/lib/navs/SettingsLink'
import { Seperator } from '@/lib/Seperator'

export default async function SettingLayout({ children }) {
  const user = await getUser()

  return (
    <div className='px-4 grid grid-cols-[auto_1fr] gap-12 mobile:grid-cols-1 mobile:gap-4'>
      <div className='sticky mt-8 grid gap-1 h-fit max-w-52 mobile:max-w-full'>
        <SettingsLink href='/settings/self_edit' icon='user' title='פרופיל אישי' />

        {user.role == 'ADMIN' && (
          <>
            <Seperator className='my-2' />
            <SettingsLink href='/settings/edit_teams' icon='users' title='צוותים' />
            <SettingsLink href='/settings/edit_users' icon='user-pen' title='משתמשים' />
            <SettingsLink href='/settings/edit_promotions' icon='trophy-star' title='קמפיינים' />
            <SettingsLink href='/settings/calc_commission' icon='calculator' title='חישוב עמלות' />
            <SettingsLink href='/settings/edit_contracts' icon='file-contract' title='הסכמי עמלה' />
            <SettingsLink href='/settings/edit_tmplts' icon='list-check' title='תבניות משימות' />
            <Seperator className='my-2' />
            <SettingsLink href='/settings/update_agency' icon='diamond' title='פרטי העסק' />
            <SettingsLink href='/settings/update_user_details' icon='user' title='פרטי נציג' />
            <SettingsLink href='/settings/update_default' icon='folders' title='הגדרות מערכת' />
            <SettingsLink href='/settings/update_security' icon='shield' title='אבטחה' />
            <SettingsLink href='/settings/update_payment' icon='credit-card' title='מנוי ותשלום' />
          </>
        )}
      </div>
      <div>{children}</div>
    </div>
  )
}
