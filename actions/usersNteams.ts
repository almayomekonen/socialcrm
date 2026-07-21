'use server'

import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { Role } from '@/types/db/tables'
import { Roles, isAdmin } from '@/types/roles'
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
// Columns an ADMIN may set on a managed user via the edit-users form. Excludes
// identity/tenant columns (id, agencyId, otp, gglSub, createdById).
const USER_ADMIN_WRITABLE = ['firstName', 'lastName', 'email', 'phone', 'role', 'suspended', 'goals'] as const

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
  const authUser = await requireUser()
  if (!isAdmin(authUser.role)) throw new Error('Forbidden')
  const { gotPermIds } = data

  const userToUpsert: Record<string, unknown> = { ...pickCols(data, USER_ADMIN_WRITABLE), agencyId: authUser.agencyId }
  if (userToUpsert.email) userToUpsert.email = String(userToUpsert.email).toLowerCase().trim()

  let userId = id

  if (userId) {
    // Update only a user in the caller's own agency.
    const rows = await db('users').where({ id: userId, agencyId: authUser.agencyId }).update(userToUpsert)
    if (!rows) throw new Error('Forbidden')
  } else {
    const res = await db('users').insert(userToUpsert).returning('id')
    userId = res[0].id
    await db('default_settings').insert({ userId })
  }

  if (userToUpsert.role === Roles.OFFICE) {
    await db('user_perms').where('gaveId', userId).del()
  }

  if (gotPermIds) {
    // Only grant permissions from users that belong to the caller's agency.
    const safePermIds: number[] =
      Array.isArray(gotPermIds) && gotPermIds.length
        ? await db('users').whereIn('id', gotPermIds).andWhere({ agencyId: authUser.agencyId }).pluck('id')
        : []
    await db.transaction(async (trx) => {
      await trx('user_perms').where('gotId', userId).del()

      if (safePermIds.length > 0) {
        const permsToInsert = safePermIds.map((gaveId: number) => ({
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
  const authUser = await requireUser()
  if (!isAdmin(authUser.role)) throw new Error('Forbidden')
  const safe: Record<string, unknown> = { ...pickCols(user, USER_ADMIN_WRITABLE), agencyId: authUser.agencyId }
  if (safe.email) safe.email = String(safe.email).toLowerCase().trim()

  if (id) {
    // Update only a user in the caller's own agency.
    const rows = await db('users').where({ id, agencyId: authUser.agencyId }).update(safe)
    if (!rows) throw new Error('Forbidden')
  } else {
    const [{ id: newUserId }] = await db('users').insert(safe).returning('id')
    await db('default_settings').insert({ userId: newUserId })
  }

  revalidatePath('/settings/edit_users')
  revalidatePath('/settings/self_edit')
}

export async function deleteUser(id) {
  const user = await requireUser()
  if (!isAdmin(user.role)) throw new Error('Forbidden')
  await db('users').where({ id, agencyId: user.agencyId }).del()
  revalidatePath('/settings/edit_users')
}

export async function updateGavePerm(_curUserId, addedUserId) {
  const user = await requireUser()
  // A user may only delegate access to their OWN leads (gaveId = caller), and
  // only to a user within their agency. The client-supplied grantor is ignored.
  const target = await db('users').where({ id: addedUserId, agencyId: user.agencyId }).first('id')
  if (!target) throw new Error('Forbidden')
  await db('user_perms')
    .insert({
      gaveId: user.id,
      gotId: addedUserId,
    })
    .onConflict(['gaveId', 'gotId'])
    .ignore()

  revalidatePath('/settings/edit_self')
}

export async function removeAuthUser(_userId, removeUserId) {
  const user = await requireUser()
  // Caller can only revoke permissions they themselves granted (gaveId = caller).
  await db('user_perms').where({ gaveId: user.id, gotId: removeUserId }).del()

  revalidatePath('/settings/edit_self')
}

export async function deleteTeam(id: number) {
  const user = await requireUser()
  if (!isAdmin(user.role)) throw new Error('Forbidden')
  await db('teams').where({ id, agencyId: user.agencyId }).del()
  revalidatePath('/settings/edit_teams')
}

export async function upsertTeam(id: number, team: any) {
  const user = await requireUser()
  if (!isAdmin(user.role)) throw new Error('Forbidden')
  let teamId = id

  if (id) {
    // Update only a team in the caller's own agency.
    const owned = await db('teams').where({ id, agencyId: user.agencyId }).first('id')
    if (!owned) throw new Error('Forbidden')
    await Promise.all([db('teams').where({ id }).update({ name: team.name }), db('user_teams').where('teamId', id).del()])
  } else {
    const newTeam = await db('teams').insert({ name: team.name, agencyId: user.agencyId }).returning('id')
    teamId = newTeam[0].id
  }

  // Only users within the caller's agency may be added as team members.
  const memberIds: number[] = [...(team.userIds ?? []), ...(team.mngrIds ?? []), ...(team.officeIds ?? [])]
  const validIds = new Set<number>(
    memberIds.length ? await db('users').whereIn('id', memberIds).andWhere({ agencyId: user.agencyId }).pluck('id') : [],
  )
  const userTeams = [
    ...team.userIds.filter((uid: number) => validIds.has(uid)).map((userId: number) => ({ userId, teamId, type: 'user' })),
    ...team.mngrIds
      .filter((uid: number) => validIds.has(uid))
      .map((mngrId: number) => ({ userId: mngrId, teamId, type: 'mngr' })),
    ...team.officeIds
      .filter((uid: number) => validIds.has(uid))
      .map((officeId: number) => ({ userId: officeId, teamId, type: 'office' })),
  ]
  if (userTeams.length) await db('user_teams').insert(userTeams)

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
