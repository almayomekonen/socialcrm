import { getUser } from '@/db/auth'
import { getPerms } from '@/db/filter'
import { getPromo, getPromoTotals, getTeamsPromoTotals } from '@/db/promos'
import { formatNumAndPrecent } from '@/components/promo/funcs'
import PromoTable from '@/components/promo/PromoTable'
import UserPromo from '@/components/promo/UserPromo'
import { db } from '@/config/db'
import { addNotIncludedUsers } from '@/db/sumSales'
import { isAdmin } from '@/types/roles'

export default async function PromotionPage({ params, searchParams }) {
  const user = await getUser()
  const { id } = await params
  let { filter } = await searchParams
  try { filter = filter ? JSON.parse(filter) : {} } catch { filter = {} }
  let promo = await getPromo(id)
  if (!promo) return <p className='font-bold text-lg m-4'>קמפיין לא נמצא</p>
  try { promo.goals = JSON.parse(promo.goals) } catch { return <p className='font-bold text-lg m-4'>שגיאה בטעינת הקמפיין</p> }
  const conditions = promo.goals.conditions

  const sql = db
    .where({ action: 'מכירה' })
    .whereNotIn('status', ['נגנז', 'בוטל'])
    .whereBetween('offrDt', [promo.start, promo.end])

  if (promo.isPromoGrp) return TeamPromo({ promo, sql })

  let userTotals = await getPromoTotals(conditions, sql.clone().whereIn('userId', promo.combined_ids))
  if (!userTotals.length)
    return (
      <div>
        <UserPromo curUser={null} promo={promo} />
        <p className='font-bold text-lg mt-4'>אין עדיין נתונים למבצע</p>
      </div>
    )
  const firstColName = userTotals[0] ? Object.keys(userTotals[0])[1] : null
  if (firstColName) tryme(() => sort(userTotals, firstColName))

  userTotals = await addNotIncludedUsers({ res: userTotals, userIds: promo.combined_ids, nameKey: 'נציג' })

  const userIds = promo.combined_ids

  if (!isAdmin(user.role)) {
    const { gotPermIds } = await getPerms(user)
    const hasAccess = userIds.some((id) => gotPermIds.includes(id))
    if (!hasAccess) return <p className='font-bold text-lg m-4'>אינך כלול בקמפיין הנוכחי</p>
  }

  const curUser = userTotals.find((el: any) => el.נציג === user.name)

  const formatData = userTotals.map((user) => formatNumAndPrecent(user, promo))

  return (
    <div>
      <UserPromo curUser={curUser} promo={promo} />
      <PromoTable data={formatData} promo={promo} key={Math.random()} />
    </div>
  )
}

// TEAM PROMO
async function TeamPromo({ promo, sql }) {
  const conditions = promo.goals.conditions
  sql.whereIn('t.id', promo.grpIds)

  const userTotals = await getTeamsPromoTotals({ sql, conditions })
  const formatData = userTotals.map((user) => formatNumAndPrecent(user, promo))

  return (
    <div>
      <UserPromo curUser={userTotals} promo={promo} />
      <PromoTable data={formatData} promo={promo} key={Math.random()} />
    </div>
  )
}

function sort(arr, key) {
  arr.sort((a, b) => b[key] - a[key])
}

function tryme(fn) {
  try {
    fn()
  } catch (_) {
    // sort is best-effort — continue without sorting
  }
}
