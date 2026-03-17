import { getUser } from '@/db/auth'
import IpsTable from '@/components/settings/security/IpsTable'
import AccordionItem from '@/lib/AccordionItem'
import LogoutMinutesForm from '@/components/settings/security/LogoutMinutesForm'
import { getFullUser } from '@/db/usersNTeams'

export default async function page() {
  const user = await getUser()
  const res = await getFullUser({
    id: user.id,
    select: [
      'idNum',
      'firstName',
      'lastName',
      'email',
      'phone',
      'fax',
      'officePhone',
      'agentLicenseNum',
      'agentLicenseFiles',
      'logoutMinutes',
    ],
  })

  const ipData = [
    {
      ip: '192.168.1.1',
      date: '2021-01-01',
    },
    {
      ip: '192.168.1.2',
      date: '2021-01-02',
    },
    {
      ip: '192.168.1.3',
      date: '2021-01-03',
    },
  ]

  const bodyClass = 'p-6'
  return (
    <div>
      <h1 className='title'>אבטחה</h1>
      <div className='accordion my-6 max-w-2xl'>
        <AccordionItem bodyClass={bodyClass} title='הוספת אימות דו שלבי'>
          <div>
            <p>אימות דו שלבי</p>
          </div>
        </AccordionItem>
        <AccordionItem bodyClass={bodyClass} title='עדכון סיסמה'>
          <div>
            <p>עדכון סיסמה</p>
          </div>
        </AccordionItem>
        <AccordionItem bodyClass={bodyClass} title='פרק הזמן לניתוק מהמערכת'>
          <LogoutMinutesForm user={res} />
        </AccordionItem>
        <AccordionItem bodyClass={bodyClass} title='כתובות IP שהתחברו למשתמש'>
          <IpsTable data={ipData} />
        </AccordionItem>
      </div>
    </div>
  )
}
