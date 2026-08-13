/**
 * Decide how a server-verified Facebook identity maps onto SocialCRM users.
 * Identity (email + facebookSub) must already have come from Meta — never from the client.
 */
export type FacebookAccountRow = {
  id: number
  suspended?: boolean
  facebookSub?: string | null
}

export type FacebookLoginResolution =
  | { kind: 'login'; userId: number; attachFacebookSub: boolean; verifyEmail: boolean }
  | { kind: 'register' }
  | { kind: 'reject'; reason: 'suspended' | 'conflict' }

export function resolveFacebookLogin(args: {
  facebookSub: string
  bySub: FacebookAccountRow | null
  byEmail: FacebookAccountRow | null
}): FacebookLoginResolution {
  const { facebookSub, bySub, byEmail } = args

  if (bySub && byEmail && Number(bySub.id) !== Number(byEmail.id)) {
    return { kind: 'reject', reason: 'conflict' }
  }
  if (byEmail?.facebookSub && byEmail.facebookSub !== facebookSub) {
    return { kind: 'reject', reason: 'conflict' }
  }

  const user = bySub ?? byEmail
  if (!user) return { kind: 'register' }
  if (user.suspended) return { kind: 'reject', reason: 'suspended' }

  const emailMatchesThisUser = !!byEmail && Number(byEmail.id) === Number(user.id)
  return {
    kind: 'login',
    userId: user.id,
    attachFacebookSub: !user.facebookSub,
    verifyEmail: emailMatchesThisUser,
  }
}
