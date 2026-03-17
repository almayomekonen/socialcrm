import { getUser } from '@/db/auth'
import AiSettingsForm from '@/components/settings/default/AiSettingsForm'
import ClientSivugForm from '@/components/settings/default/ClientSivugForm'
import { getDefaultSettings } from '@/db/usersNTeams'
import AccordionItem from '@/lib/AccordionItem'

export default async function page() {
  const bodyClass = 'p-6'
  const user = await getUser()
  const data = await getDefaultSettings(user.id)
  return (
    <div>
      <h1 className='title'>נתוני ברירת מחדל</h1>
      <h1 className='text-xl font-bold mt-12'>הגדרות סיווג לקוח</h1>
      <div className='accordion border rounded-lg my-6 max-w-3xl bg-white'>
        <AccordionItem bodyClass={bodyClass} title='עדכון הגדרות סיווג לקוח'>
          <ClientSivugForm data={data} userId={user.id} />
        </AccordionItem>
      </div>
      <h1 className='text-xl font-bold mt-12'>הגדרות AI</h1>
      <AiSettingsForm key={Math.random()} userId={user.id} data={data} />
    </div>
  )
}
