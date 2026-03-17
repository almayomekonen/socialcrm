'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { Role } from '@/types/db/tables'
import { getAgencyId } from '@/db/agencies'
import { Roles } from '@/types/roles'
import { getUserNameById } from '@/db/usersNTeams'
import { requireUser } from '@/lib/requireUser'

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
      // 1. Delete ALL existing permissions where I am the receiver
      await trx('user_perms').where('gotId', userId).del()

      // 2. Insert ALL permissions from the new list
      if (gotPermIds.length > 0) {
        const permsToInsert = gotPermIds.map((gaveId: number) => ({
          gotId: userId,
          gaveId,
        }))

        // Using insert without onConflict is safe because we just deleted everything for this gotId
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
  await requireUser()
  await db.transaction(async (trx) => {
    await trx('sale_users').where('userId', fromUserId).update({ userId: toUserId })
    await trx('sales').where('handlerId', fromUserId).update({ handlerId: toUserId })
    await trx('sales').where('createdById', fromUserId).update({ createdById: toUserId })
    await trx('clients').where('createdById', fromUserId).update({ createdById: toUserId })
  })
}

// ext users

export async function upsertExtUser(extUser, id?) {
  const user = await getUser()

  const res = id
    ? await db('users').where({ id }).update(extUser).returning('*')
    : await db('users')
        .insert({
          ...extUser,
          role: 'EXT' as Role,
          createdById: user.id,
          agencyId: await getAgencyId(),
        })
        .returning('name')

  revalidatePath('/settings')

  return res[0]
}

export async function deleteExtUser(id) {
  await requireUser()
  const res = await db('sale_users').where('userId', id).first()
  if (res) {
    throw new Error('לא ניתן למחוק משתמש עם מכירות')
  }
  await db('users').where({ id }).del()
  revalidatePath('/settings/update_ext_users')
  return true
}

export async function updateFullUser(data, userId) {
  await requireUser()
  if (data.userData) await db('users').where({ id: userId }).update(data.userData)
  if (data.userInfoData) await db('users_info').where({ id: userId }).update(data.userInfoData)
  revalidatePath('/settings/self_edit')
  revalidatePath('/settings/update_user_details')
}

export async function updateUserInfoData(data, userId) {
  await requireUser()
  await db('users_info').where({ id: userId }).update(data)
  revalidatePath('/settings/update_user_details')
}

export async function updateDefaultSettings(data, userId) {
  await requireUser()
  await db('default_settings').where({ userId }).update(data)
  revalidatePath('/settings/update_default')
}

export async function fetchUserNameById(userId) {
  return getUserNameById(userId)
}
