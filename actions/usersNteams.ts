'use server'

import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { Role } from '@/types/db/tables'
import { getAgencyId } from '@/db/agencies'
import { Roles } from '@/types/roles'
import { getUserNameById } from '@/db/usersNTeams'
import { requireUser } from '@/lib/requireUser'
import { normalizeDefaultSettings } from '@/lib/form/funcs'

const USER_SELF_WRITABLE = ['firstName', 'lastName', 'email', 'idNum', 'phone'] as const
const USER_INFO_WRITABLE = [
  'fax',
  'officePhone',
  'agentLicenseNum',
  'logoutMinutes',
  'tifulEmail',
  'agentLicenseType',
  'agentLicenseName',
] as const
const EXT_USER_WRITABLE = ['firstName', 'lastName'] as const

function pickCols(data: unknown, allowed: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (data && typeof data === 'object') {
    for (const key of allowed) {
      if (key in (data as Record<string, unknown>)) out[key] = (data as Record<string, unknown>)[key]
    }
  }
  return out
}

export async function upsertUserNPerms(data, id) {
  await requireUser()
  const { gotPermIds, ...user } = data

  const userToUpsert = { ...user, email: user.email.toLowerCase().trim(), agencyId: await getAgencyId() }

  let userId = id

  if (userId) {
    await db('users').where({ id: userId }).update(userToUpsert)
  } else {
    const res = await db('users').insert(userToUpsert).returning('id')
    userId = res[0].id
    await db('default_settings').insert({ userId })
  }

  if (user.role === Roles.OFFICE) {
    await db('user_perms').where('gaveId', userId).del()
  }

  if (gotPermIds) {
    await db.transaction(async (trx) => {
      await trx('user_perms').where('gotId', userId).del()

      if (gotPermIds.length > 0) {
        const permsToInsert = gotPermIds.map((gaveId: number) => ({
          gotId: userId,
          gaveId,
        }))

        await trx('user_perms').insert(permsToInsert)
      }
    })
  }

  revalidatePath('/settings/edit_users')
}

export async function upsertUser(user, id) {
  await requireUser()
  user = { ...user, email: user.email.toLowerCase().trim(), agencyId: await getAgencyId() }
  if (id) await db('users').where({ id }).update(user)
  else {
    const [{ id: newUserId }] = await db('users').insert(user).returning('id')
    await db('default_settings').insert({ userId: newUserId })
  }

  revalidatePath('/settings/edit_users')
  revalidatePath('/settings/self_edit')
}

export async function deleteUser(id) {
  await requireUser()
  await db('users').where({ id }).del()
  revalidatePath('/settings/edit_users')
}

export async function updateGavePerm(curUserId, addedUserId) {
  await requireUser()
  await db('user_perms')
    .insert({
      gaveId: curUserId,
      gotId: addedUserId,
    })
    .onConflict(['gaveId', 'gotId'])
    .ignore()

  revalidatePath('/settings/edit_self')
}

export async function removeAuthUser(userId, removeUserId) {
  await requireUser()
  await db('user_perms').where({ gaveId: userId, gotId: removeUserId }).del()

  revalidatePath('/settings/edit_self')
}

export async function deleteTeam(id: number) {
  await requireUser()
  await db('teams').where({ id }).del()
  revalidatePath('/settings/edit_teams')
}

export async function upsertTeam(id: number, team: any) {
  await requireUser()
  let teamId = id

  if (id) {
    await Promise.all([db('teams').where({ id }).update({ name: team.name }), db('user_teams').where('teamId', id).del()])
  } else {
    const newTeam = await db('teams')
      .insert({ name: team.name, agencyId: await getAgencyId() })
      .returning('id')
    teamId = newTeam[0].id
  }

  const userTeams = [
    ...team.userIds.map((userId: number) => ({ userId, teamId, type: 'user' })),
    ...team.mngrIds.map((mngrId: number) => ({ userId: mngrId, teamId, type: 'mngr' })),
    ...team.officeIds.map((officeId: number) => ({ userId: officeId, teamId, type: 'office' })),
  ]
  await db('user_teams').insert(userTeams)

  revalidatePath('/settings/edit_teams')
}

export async function fetchUsersByMngrId(mngrId: number) {
  return await db('user_teams as mngr_teams')
    .join('user_teams as member_teams', 'mngr_teams.teamId', 'member_teams.teamId')
    .join('users', 'member_teams.userId', 'users.id')
    .where('mngr_teams.userId', mngrId)
    .where('mngr_teams.type', 'mngr')
    .distinct('users.id', 'users.name')
}

export async function fetchIsUserHaveSales(userId: number) {
  const res = await db('sale_users').where('userId', userId).first()
  return !!res
}

export async function transferSales(fromUserId: number, toUserId: number) {
  const user = await requireUser()
  const [from, to] = await Promise.all([
    db('users').where({ id: fromUserId, agencyId: user.agencyId }).first('id'),
    db('users').where({ id: toUserId, agencyId: user.agencyId }).first('id'),
  ])
  if (!from || !to) throw new Error('Forbidden')
  await db.transaction(async (trx) => {
    await trx('sale_users').where('userId', fromUserId).update({ userId: toUserId })
    await trx('sales').where('handlerId', fromUserId).update({ handlerId: toUserId })
    await trx('sales').where('createdById', fromUserId).update({ createdById: toUserId })
    await trx('clients').where('createdById', fromUserId).update({ createdById: toUserId })
  })
}

// ext users

export async function upsertExtUser(extUser, id?) {
  const user = await requireUser()
  const safe = pickCols(extUser, EXT_USER_WRITABLE)

  if (id) {
    // Update only an EXT user that belongs to the caller's own agency, and only
    // whitelisted columns — blocks cross-tenant edits and role/agency injection.
    const res = await db('users')
      .where({ id, agencyId: user.agencyId, role: 'EXT' as Role })
      .update(safe)
      .returning('*')
    if (!res.length) throw new Error('Forbidden')
    revalidatePath('/settings')
    return res[0]
  }

  const res = await db('users')
    .insert({ ...safe, role: 'EXT' as Role, createdById: user.id, agencyId: user.agencyId })
    .returning('name')

  revalidatePath('/settings')

  return res[0]
}

export async function deleteExtUser(id) {
  const user = await requireUser()
  // Only an EXT user within the caller's agency may be deleted.
  const target = await db('users')
    .where({ id, agencyId: user.agencyId, role: 'EXT' as Role })
    .first('id')
  if (!target) throw new Error('Forbidden')
  const res = await db('sale_users').where('userId', id).first()
  if (res) {
    throw new Error('לא ניתן למחוק משתמש עם מכירות')
  }
  await db('users').where({ id, agencyId: user.agencyId }).del()
  revalidatePath('/settings/update_ext_users')
  return true
}

// Self-edit only. These three actions edit the authenticated user's own
// records; the client-supplied `userId` is intentionally ignored so it cannot
// be pointed at another account (cross-tenant / cross-user write). Column
// allowlists additionally block privilege columns on the `users` table.
export async function updateFullUser(data, _userId?) {
  const user = await requireUser()
  if (data?.userData) {
    const userData = pickCols(data.userData, USER_SELF_WRITABLE)
    if (Object.keys(userData).length) await db('users').where({ id: user.id }).update(userData)
  }
  if (data?.userInfoData) {
    const userInfoData = pickCols(data.userInfoData, USER_INFO_WRITABLE)
    if (Object.keys(userInfoData).length) await db('users_info').where({ id: user.id }).update(userInfoData)
  }
  revalidatePath('/settings/self_edit')
  revalidatePath('/settings/update_user_details')
}

export async function updateUserInfoData(data, _userId?) {
  const user = await requireUser()
  const safe = pickCols(data, USER_INFO_WRITABLE)
  if (Object.keys(safe).length) await db('users_info').where({ id: user.id }).update(safe)
  revalidatePath('/settings/update_user_details')
}

export async function updateDefaultSettings(data: Record<string, unknown>, _userId?: number) {
  const user = await requireUser()

  const normalized = normalizeDefaultSettings(data)

  const existing = await db('default_settings').where({ userId: user.id }).first()
  if (existing) {
    await db('default_settings').where({ userId: user.id }).update(normalized)
  } else {
    await db('default_settings').insert({ userId: user.id, ...normalized })
  }

  revalidatePath('/settings/update_default')
}

export async function fetchUserNameById(userId) {
  return getUserNameById(userId)
}
