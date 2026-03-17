import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { imgJsonAgg } from './helpers/aggregations'

export async function getAgencyById(id: number) {
  'use cache'

  return await db('agencies')
    .where('agencies.id', id)
    .leftJoin({ main_img: 'files' }, 'main_img.id', 'agencies.img')
    .select('agencies.*', db.raw(`${imgJsonAgg} as img`))
    .first()
}

export async function getCurPkg() {
  const user = await getUser()
  const res = await db('agencies').where({ id: user?.agencyId }).select('pkg').first()
  return res?.pkg
}

export async function getAgencyId() {
  const user = await getUser()
  return user.agencyId
}
