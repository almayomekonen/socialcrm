import { getTeams, getUsers } from '@/db/usersNTeams'
import { getPromos } from '@/db/promos'
import PromoCards from '@/components/promo/PromoCards'
export default async function EditPromotionPage() {
  const teams = await getTeams()
  const users = await getUsers()

  const promos = await getPromos()

  return (
    <div className='my-8'>
      <PromoCards promos={promos} teams={teams} users={users} />
    </div>
  )
}
