import { getTeams, getUsers } from '@/db/usersNTeams'
import { getPromos } from '@/db/promos'
import PromoCards from '@/components/promo/PromoCards'
export default async function EditPromotionPage() {
  const teams = await getTeams()
  const users = await getUsers()

  const promos = await getPromos()

  if (promos.length === 0) {
    return <div className='flex items-center justify-center h-64 text-gray-400'>אין מבצעים עדיין</div>
  }

  return (
    <div className='my-8'>
      <PromoCards promos={promos} teams={teams} users={users} />
    </div>
  )
}
