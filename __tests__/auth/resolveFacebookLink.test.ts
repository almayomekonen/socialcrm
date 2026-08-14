import { describe, expect, it } from 'vitest'
import { resolveFacebookLink } from '@/lib/auth/resolveFacebookLink'

const SUB = '27802810426038835'

describe('resolveFacebookLink', () => {
  it('attaches a verified Facebook id to the session user when neither side is linked', () => {
    expect(
      resolveFacebookLink({
        facebookSub: SUB,
        sessionUserId: 332,
        currentFacebookSub: null,
        existingOwnerId: null,
      }),
    ).toEqual({ kind: 'attach' })
  })

  it('is idempotent when the same Facebook id is already on this user', () => {
    expect(
      resolveFacebookLink({
        facebookSub: SUB,
        sessionUserId: 332,
        currentFacebookSub: SUB,
        existingOwnerId: 332,
      }),
    ).toEqual({ kind: 'already_linked' })
  })

  it('rejects when the Facebook id belongs to another SocialCRM user', () => {
    expect(
      resolveFacebookLink({
        facebookSub: SUB,
        sessionUserId: 332,
        currentFacebookSub: null,
        existingOwnerId: 99,
      }),
    ).toEqual({ kind: 'reject', reason: 'taken' })
  })

  it('rejects when the session user already has a different Facebook id', () => {
    expect(
      resolveFacebookLink({
        facebookSub: SUB,
        sessionUserId: 332,
        currentFacebookSub: 'other-facebook-id',
        existingOwnerId: null,
      }),
    ).toEqual({ kind: 'reject', reason: 'already_linked_other' })
  })
})
