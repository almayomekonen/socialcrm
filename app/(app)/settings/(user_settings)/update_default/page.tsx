import { getUser } from '@/db/auth'
import AiSettingsForm from '@/components/settings/default/AiSettingsForm'
import { getDefaultSettings } from '@/db/usersNTeams'

export default async function page() {
  const user = await getUser()
  const data = await getDefaultSettings(user.id)
  return (
    <div>
      <h1 className='title'>הגדרות מערכת</h1>
      <AiSettingsForm key={Math.random()} userId={user.id} data={data} />
    </div>
  )
}
