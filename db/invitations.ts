import { db } from '@/config/db'
import { getAgencyId } from './agencies'

export async function getInvitations() {
  const invitations = await db('invitations')
    .where('agencyId', await getAgencyId())
    .orderBy('createdAt', 'desc')
  return invitations
}
