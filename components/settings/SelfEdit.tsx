'use client'
import AddAuthUsersComp from '@/components/agntsAndGrps/AddAuthUsers'
import EditFilters from '@/components/filter/EditSavedFilters'
import UserDetailsForm from '@/components/settings/userDetails/UserDetailsForm'
import AccordionItem from '@/lib/AccordionItem'
import UploadClientData from '@/components/settings/UploadClientData'

import { useSearchParams } from 'next/navigation'
import ExtUsers from '../extUsers'

export default function SelfEdit({ curUser, users, extUsers, allUsers, user, gavePerm }) {
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')
  const bodyClass = 'p-6'
  return (
    <div>
      <h1 className='title'> פרטים אישיים</h1>
      <div className='accordion my-6 max-w-2xl'>
        <AccordionItem icon='user' bodyClass={bodyClass} title='פרטים אישיים'>
          <UserDetailsForm user={curUser} />
        </AccordionItem>
        <AccordionItem icon='shield-check' bodyClass={bodyClass} title='הרשאות'>
          <AddAuthUsersComp users={users} gavePerm={gavePerm} user={user} />
        </AccordionItem>
        <AccordionItem icon='user-alien' bodyClass={'p-6'} title='סוכנים חיצוניים' open={tab === 'ext_users'}>
          <ExtUsers extUsers={extUsers} users={allUsers} />
        </AccordionItem>
        <AccordionItem icon='filter' bodyClass={bodyClass} title='סינונים' open={tab === 'filters'}>
          <EditFilters filters={user.savedFilters} user={user} />
        </AccordionItem>
        <AccordionItem icon='file-excel' bodyClass={bodyClass} title='העלאת נתוני לקוחות'>
          <UploadClientData />
        </AccordionItem>
      </div>
    </div>
  )
}
