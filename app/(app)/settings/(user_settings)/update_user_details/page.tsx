import { getUser } from '@/db/auth'
import UserAgntLicenseForm from '@/components/settings/userDetails/UserAgentLicenseForm'
import UserDetailsForm from '@/components/settings/userDetails/UserDetailsForm'
import UserContactForm from '@/components/settings/userDetails/UserPhonesForm'
import { getFullUser } from '@/db/usersNTeams'
import AccordionItem from '@/lib/AccordionItem'

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
      'agentLicenseType',
      'agentLicenseName',
      'agentLicenseFiles',
      'tifulEmail',
    ],
  })

  const bodyClass = 'p-6'
  return (
    <div>
      <h1 className='title'>פרטי נציג</h1>
      <div className='accordion my-6 max-w-2xl'>
        <AccordionItem bodyClass={bodyClass} title='עדכון פרטים אישיים'>
          <UserDetailsForm user={res} />
        </AccordionItem>
        <AccordionItem bodyClass={bodyClass} title='עדכון פרטי התקשרות'>
          <UserContactForm user={res} />
        </AccordionItem>
        <AccordionItem bodyClass={bodyClass} title='עדכון רישיון'>
          <UserAgntLicenseForm user={res} />
        </AccordionItem>
      </div>
    </div>
  )
}
