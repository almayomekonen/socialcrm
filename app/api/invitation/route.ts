import { NextRequest, after } from 'next/server'
import { db } from '@/config/db'
import { createCookie } from '@/db/auth'
import { dispatchLifecycleEvent } from '@/lib/emailAutomations/live'
import { normalizeEmail } from '@/lib/normalizeEmail'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  console.log(token, 'token')
  if (!token) return failed('Missing token')

  const invitation = await db('invitations').where({ token }).first()
  console.log(invitation, 'invitation')

  if (!invitation) return failed('Invitation not found')
  if (new Date(invitation.expiresAt) < new Date()) return failed('Invitation has expired')

  const normalizedEmail = normalizeEmail(invitation.email)
  const existingUser = await db('users').whereILike('email', normalizedEmail).first()
  if (existingUser) return failed('A user with this email already exists.')

  try {
    const [newUser] = await db('users')
      .insert({
        email: normalizedEmail,
        firstName: invitation.firstName,
        lastName: invitation.lastName,
        phone: invitation.phone,
        role: invitation.role,
        agencyId: invitation.agencyId,
        createdById: invitation.createdById,
      })
      .returning('*')

    await db('default_settings').insert({ userId: newUser.id })
    // Consume the invitation directly. This route is pre-session (the invitee
    // is accepting via a token we already validated above), so it must not call
    // the now admin-gated deleteInvitation action.
    await db('invitations').where({ id: invitation.id }).del()

    await createCookie(newUser.id)

    after(() =>
      dispatchLifecycleEvent(
        'user.registered',
        { userId: newUser.id, agencyId: newUser.agencyId, email: newUser.email, firstName: newUser.firstName },
        new Date(),
      ),
    )

    return new Response(null, {
      status: 302,
      headers: { Location: '/' },
    })
  } catch (error) {
    console.error('Failed to create user from invitation:', error)
    return failed('Could not create user account.')
  }
}

const failed = (error: string) => {
  // const url = new URL('/auth', baseUrl)
  // url.searchParams.set('error', error)
  return new Response(null, {
    status: 302,
    headers: { Location: `/auth?error=${error}` },
  })
}
