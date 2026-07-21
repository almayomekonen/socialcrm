'use server'
import { db } from '@/config/db'
import { genToken } from '@/lib/funcs'
import { sendEmail } from '@/lib/email/sender'
import { getAgencyById } from '@/db/agencies'
import { revalidatePath } from 'next/cache'
import { MapRoles, isAdmin, INVITABLE_ROLES } from '@/types/roles'
import { baseUrl } from '@/types/vars'
import { normalizeEmail } from '@/lib/normalizeEmail'
import { requireUser } from '@/lib/requireUser'

interface SendInvitationArgs {
  email: string
  role: string
  firstName: string
  lastName: string
  phone: string | null
  agencyId: string
}

export async function sendInvitation({ email, role, firstName, phone, lastName }: SendInvitationArgs) {
  // Inviting is an ADMIN capability (edit_users is an ADMIN-only surface) and
  // the invitation decides the new account's role — so without this gate any
  // authenticated user could invite themselves an ADMIN account.
  const user = await requireUser()
  if (!isAdmin(user.role)) return { error: 'אין הרשאה' }
  if (typeof role !== 'string' || !INVITABLE_ROLES.has(role)) return { error: 'תפקיד לא תקין' }

  const { name: agencyName } = await getAgencyById(user.agencyId)
  const token = genToken()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days expiry
  email = normalizeEmail(email)

  const invitationLink = `${baseUrl}/api/invitation?token=${token}`
  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: white; border: 1px solid #ddd; border-radius: 8px;">
      <div style="text-align: center; padding: 20px; border-bottom: 1px solid #eee;">
        <h2 style="margin: 0; color: #333;">${agencyName}</h2>
      </div>
      <div style="padding: 20px;">
        <p style="font-size: 18px; margin-bottom: 15px;">שלום ${firstName},</p>
        <p style="margin-bottom: 15px;">הוזמנת להצטרף ל-SocialCRM תחת הסוכנות ${agencyName}.</p>
        <p style="background: #f5f5f5; padding: 10px; border-radius: 4px; font-size: 14px; color: #666;">הוזמנת על ידי: ${user.name}</p>
        <p style="margin-bottom: 15px;">התפקיד הנבחר עבורך הוא: ${MapRoles[role]}</p>
        <div style="text-align: center; margin: 20px 0;">
          <a href="${invitationLink}" style="display: inline-block; background: #007bff; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold;">לחץ כאן להצטרפות</a>
        </div>
        <p style="color: #d63384; font-size: 14px; text-align: center;">הקישור יפוג בעוד 7 ימים.</p>
      </div>
      <div style="text-align: center; padding: 15px; border-top: 1px solid #eee; background: #f8f9fa;">
        <p style="margin: 0; color: #666; font-size: 12px;">SocialCRM</p>
      </div>
    </div>
  `

  try {
    await db.transaction(async (trx) => {
      await trx('invitations').insert({
        email,
        token,
        role,
        firstName,
        lastName,
        phone,
        createdById: user.id,
        agencyId: user.agencyId,
        expiresAt,
      })

      const result = await sendEmail({
        to: email,
        subject: 'הזמנת הצטרפות לסוכנות ' + agencyName,
        html,
      })

      if ('error' in result) {
        throw new Error(`send-failed: ${result.error}`)
      }
    })

    revalidatePath('/settings/edit_users')
    return { success: true }
  } catch (err: any) {
    const isSendFailure = typeof err?.message === 'string' && err.message.startsWith('send-failed:')
    console.error('Failed to create invitation:', err)
    return { error: isSendFailure ? 'שליחת ההזמנה נכשלה. נסה שוב.' : 'אירעה שגיאה ביצירת ההזמנה.' }
  }
}

export async function deleteInvitation(id: number) {
  // Admin-only (edit_users is an ADMIN surface) and scoped to the caller's
  // agency. Previously this had no auth at all and matched a bare id, so any
  // unauthenticated caller could delete any tenant's pending invitations.
  const user = await requireUser()
  if (!isAdmin(user.role)) throw new Error('Forbidden')
  await db('invitations').where({ id, agencyId: user.agencyId }).del()
  revalidatePath('/settings/edit_users')
}
