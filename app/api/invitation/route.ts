import { NextRequest } from 'next/server'
import { db } from '@/config/db'
import { createCookie } from '@/db/auth'
import { deleteInvitation } from '@/actions/invitations'
import { baseUrl } from '@/types/vars'

//https://www.allin.org.il/api/invitation?token=sr29rz1cnzeawy4gnty3f

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  console.log(token, 'token')
  if (!token) return failed('Missing token')

  const invitation = await db('invitations').where({ token }).first()
  console.log(invitation, 'invitation')

  if (!invitation) return failed('Invitation not found')
  if (new Date(invitation.expiresAt) < new Date()) return failed('Invitation has expired')

  const existingUser = await db('users').where({ email: invitation.email }).first()
  if (existingUser) return failed('A user with this email already exists.')

  try {
    const [newUser] = await db('users')
      .insert({
        email: invitation.email,
        firstName: invitation.firstName,
        lastName: invitation.lastName,
        phone: invitation.phone,
        role: invitation.role,
        agencyId: invitation.agencyId,
        createdById: invitation.createdById,
      })
      .returning('*')

    await db('default_settings').insert({ userId: newUser.id })
    await deleteInvitation(invitation.id)

    await createCookie(newUser.id)

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
