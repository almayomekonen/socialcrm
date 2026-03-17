'use client'
import AddAuthUsersComp from '@/components/agntsAndGrps/AddAuthUsers'
import EditFilters from '@/components/filter/EditSavedFilters'
import UserDetailsForm from '@/components/settings/userDetails/UserDetailsForm'
import AccordionItem from '@/lib/AccordionItem'
import UploadClientData from '@/components/settings/UploadClientData'

import { useSearchParams } from 'next/navigation'
import ExtUsers from '../extUsers'

const Badge = ({ label, variant }: { label: string; variant: 'start' | 'primary' | 'muted' }) => {
  const styles = {
    start: 'bg-green-100 text-green-700',
    primary: 'bg-blue-100 text-blue-700',
    muted: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[variant]}`}>{label}</span>
  )
}

export default function SelfEdit({ curUser, users, extUsers, allUsers, user, gavePerm }) {
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')
  const bodyClass = 'p-6'
  return (
    <div>
      <h1 className='title'>הגדרות החשבון</h1>
      <p className='text-gray-500 text-sm mt-1'>נהל את הפרטים האישיים שלך, הרשאות גישה וניהול לידים</p>
      <div className='accordion my-6 max-w-2xl'>
        <AccordionItem
          icon='user'
          bodyClass={bodyClass}
          title='פרטים אישיים'
          badge={<Badge label='התחל כאן' variant='start' />}
        >
          <p className='text-gray-500 text-sm mb-4'>עדכן את שמך וכתובת האימייל שלך</p>
          <UserDetailsForm user={curUser} />
        </AccordionItem>
        <AccordionItem
          icon='shield-check'
          bodyClass={bodyClass}
          title='הרשאות גישה'
          badge={<Badge label='מתקדם' variant='muted' />}
        >
          <p className='text-gray-500 text-sm mb-4'>שליטה בגישה ללידים שלך — קבע מי רשאי לצפות ולטפל בהם</p>
          <AddAuthUsersComp users={users} gavePerm={gavePerm} user={user} />
        </AccordionItem>
        <AccordionItem
          icon='user-alien'
          bodyClass={'p-6'}
          title='אנשי צוות'
          open={tab === 'ext_users'}
          badge={<Badge label='אופציונלי' variant='muted' />}
        >
          <p className='text-gray-500 text-sm mb-4'>ניהול אנשים שעובדים איתך — הוסף נציגים ושייך אליהם לידים</p>
          <ExtUsers extUsers={extUsers} users={allUsers} />
        </AccordionItem>
        <AccordionItem
          icon='file-excel'
          bodyClass={bodyClass}
          title='העלאת לידים'
          open={tab === 'upload'}
          badge={<Badge label='פעולה מרכזית' variant='primary' />}
        >
          <p className='text-gray-500 text-sm mb-4'>העלה קובץ Excel עם לידים והמערכת תייבא אותם אוטומטית (קובץ Excel בלבד, סיומת xlsx או xls)</p>
          <UploadClientData />
        </AccordionItem>
        <AccordionItem
          icon='filter'
          bodyClass={bodyClass}
          title='סינונים שמורים'
          open={tab === 'filters'}
          badge={<Badge label='מתקדם' variant='muted' />}
        >
          <p className='text-gray-500 text-sm mb-4'>שמור סינונים כדי למצוא לידים מהר יותר</p>
          <p className='text-gray-400 text-xs mb-4'>ניתן ליצור סינונים לאחר שיש לידים במערכת</p>
          <EditFilters filters={user.savedFilters} user={user} />
        </AccordionItem>
      </div>
    </div>
  )
}
