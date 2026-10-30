import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'
import { MapRoles, rolesOpt } from '@/types/roles'

/**
 * Display-only labels for the admin settings tables (Phase E5a). Every
 * producer is the IDENTITY in Hebrew (it returns the stored constant itself),
 * so Hebrew output is unchanged; other languages look the copy up by role CODE
 * or column KEY. Role codes, column keys and `user.tblPref` are never changed.
 */

const ROLE_KEY: Record<string, MessageKey> = {
  AGNT: 'admin.users.role.AGNT',
  MNGR: 'admin.users.role.MNGR',
  OFFICE: 'admin.users.role.OFFICE',
  ADMIN: 'admin.users.role.ADMIN',
  GM: 'admin.users.role.GM',
  EXT: 'admin.users.role.EXT',
}

/** `MapRoles[role]` in the interface language (an unknown code keeps `MapRoles`' answer). */
export function adminRoleLabel(role: unknown, locale: UiLocale = 'he'): string | undefined {
  const stored = MapRoles[role as keyof typeof MapRoles]
  const key = ROLE_KEY[String(role)]
  return locale === 'he' || !key ? stored : translatorFor(locale)(key)
}

/** The role pickers' options: the same `id`s (role codes) in the same order; Hebrew is `rolesOpt` itself. */
export function adminRoleOptions(locale: UiLocale = 'he'): typeof rolesOpt {
  if (locale === 'he') return rolesOpt
  return rolesOpt.map((o) => ({ id: o.id, name: adminRoleLabel(o.id, locale) as string }))
}

function byKey(map: Record<string, MessageKey>) {
  return (key: string, locale: UiLocale): string | null => (map[key] ? translatorFor(locale)(map[key]) : null)
}

/** Users table headers by column KEY. */
export const userColumnLabel = byKey({
  name: 'admin.users.col.name',
  role: 'admin.users.col.role',
  email: 'admin.users.col.email',
  phone: 'admin.users.col.phone',
  suspended: 'admin.users.col.suspended',
  gavePerm: 'admin.users.col.gavePerm',
  gotPerm: 'admin.users.col.gotPerm',
  updatedAt: 'admin.users.col.updatedAt',
  createdAt: 'admin.users.col.createdAt',
  id: 'admin.users.col.id',
})

/** Invitations table headers by column KEY. */
export const invitationColumnLabel = byKey({
  firstName: 'admin.invitations.col.firstName',
  lastName: 'admin.invitations.col.lastName',
  email: 'admin.invitations.col.email',
  role: 'admin.invitations.col.role',
  phone: 'admin.invitations.col.phone',
  createdAt: 'admin.invitations.col.createdAt',
  expiresAt: 'admin.invitations.col.expiresAt',
  status: 'admin.invitations.col.status',
})

/** Task templates table headers by column KEY. */
export const taskTmpltColumnLabel = byKey({
  title: 'admin.taskTmplts.col.title',
  createdAt: 'admin.taskTmplts.col.createdAt',
})

/** `sendInvitation`'s Hebrew answers (no code) → catalog key, by exact sentence. An unknown answer is shown as returned. */
const INVITATION_ERROR: Record<string, MessageKey> = {
  'אין הרשאה': 'admin.invitations.server.forbidden',
  'תפקיד לא תקין': 'admin.invitations.server.badRole',
  'שליחת ההזמנה נכשלה. נסה שוב.': 'admin.invitations.server.sendFailed',
  'אירעה שגיאה ביצירת ההזמנה.': 'admin.invitations.server.createFailed',
}

export function invitationErrorText(error: string, locale: UiLocale = 'he'): string {
  const key = INVITATION_ERROR[error]
  return locale === 'he' || !key ? error : translatorFor(locale)(key)
}
