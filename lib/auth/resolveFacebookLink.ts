/**
 * Decide whether a server-verified Facebook user id may be attached to the
 * current SocialCRM session user. Never matches by email. Never reads client ids.
 */
export type FacebookLinkResolution =
  | { kind: 'attach' }
  | { kind: 'already_linked' }
  | { kind: 'reject'; reason: 'taken' | 'already_linked_other' }

export function resolveFacebookLink(args: {
  facebookSub: string
  sessionUserId: number
  currentFacebookSub: string | null | undefined
  existingOwnerId: number | null | undefined
}): FacebookLinkResolution {
  const facebookSub = args.facebookSub
  const sessionUserId = Number(args.sessionUserId)
  const current = args.currentFacebookSub || null
  const ownerId = args.existingOwnerId == null ? null : Number(args.existingOwnerId)

  if (current && current === facebookSub) return { kind: 'already_linked' }
  if (current && current !== facebookSub) return { kind: 'reject', reason: 'already_linked_other' }
  if (ownerId != null && ownerId !== sessionUserId) return { kind: 'reject', reason: 'taken' }
  if (ownerId === sessionUserId) return { kind: 'already_linked' }
  return { kind: 'attach' }
}
