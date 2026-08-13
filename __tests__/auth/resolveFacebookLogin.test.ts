import { describe, expect, it } from 'vitest'
import { resolveFacebookLogin } from '@/lib/auth/resolveFacebookLogin'

const SUB = '27802810426038835'

describe('resolveFacebookLogin', () => {
  it('logs into the existing SocialCRM user when verified email matches', () => {
    expect(
      resolveFacebookLogin({
        facebookSub: SUB,
        bySub: null,
        byEmail: { id: 42, suspended: false, facebookSub: null },
      }),
    ).toEqual({ kind: 'login', userId: 42, attachFacebookSub: true, verifyEmail: true })
  })

  it('does not overwrite an email account already linked to a different facebookSub', () => {
    expect(
      resolveFacebookLogin({
        facebookSub: SUB,
        bySub: null,
        byEmail: { id: 42, facebookSub: 'other-facebook-id' },
      }),
    ).toEqual({ kind: 'reject', reason: 'conflict' })
  })

  it('rejects when facebookSub and email belong to two different users', () => {
    expect(
      resolveFacebookLogin({
        facebookSub: SUB,
        bySub: { id: 7, facebookSub: SUB },
        byEmail: { id: 42, facebookSub: null },
      }),
    ).toEqual({ kind: 'reject', reason: 'conflict' })
  })

  it('logs a returning facebookSub user into the same SocialCRM session', () => {
    expect(
      resolveFacebookLogin({
        facebookSub: SUB,
        bySub: { id: 42, facebookSub: SUB },
        byEmail: { id: 42, facebookSub: SUB },
      }),
    ).toEqual({ kind: 'login', userId: 42, attachFacebookSub: false, verifyEmail: true })
  })

  it('sends an unknown identity to registration — does not create an agency', () => {
    expect(resolveFacebookLogin({ facebookSub: SUB, bySub: null, byEmail: null })).toEqual({ kind: 'register' })
  })

  it('blocks a suspended SocialCRM user', () => {
    expect(
      resolveFacebookLogin({
        facebookSub: SUB,
        bySub: null,
        byEmail: { id: 42, suspended: true, facebookSub: null },
      }),
    ).toEqual({ kind: 'reject', reason: 'suspended' })
  })
})
