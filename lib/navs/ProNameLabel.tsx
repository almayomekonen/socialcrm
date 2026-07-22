'use client'

import type { CSSProperties } from 'react'
import { RoleLabels } from '@/types/roles'

/**
 * The user identity line in the topbar: name, an optional PRO pill, then role.
 *
 * Name and role are one string in the underlying design (`name - role`). There
 * is no separate name element to attach a pill to, so this component splits
 * that string for Pro workspaces and renders the original single <p> verbatim
 * for everyone else — same tag, same class, same text. Free accounts are
 * therefore byte-identical to what they saw before the pill existed.
 *
 * Sizing is inline styles rather than Tailwind utilities on purpose: the pill
 * needs sub-pixel values (9px type, 2px padding) that only exist as arbitrary
 * utilities, and those are generated only if the scanner has seen this file.
 * An inline style cannot silently fail to paint. Colour comes from verified
 * tokens (bg-dark → --color-ink).
 */

const PRO_PILL: CSSProperties = {
  display: 'inline-block',
  borderRadius: '999px',
  fontWeight: 700,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  fontSize: '9px',
  letterSpacing: '0.05em',
  padding: '2px 5px',
  marginInline: '6px',
  verticalAlign: 'middle',
}

export function ProNameLine({ user, isPro }: { user: any; isPro: boolean }) {
  const name = user?.name || user?.gglName
  const roleLabel = user?.role ? RoleLabels[user.role] || user.role : null

  if (!isPro) {
    return <p className='text-sm'>{`${name}${roleLabel ? ` - ${roleLabel}` : ''}`}</p>
  }

  return (
    <p className='text-sm'>
      {name}
      <span className='bg-dark text-white select-none' style={PRO_PILL}>
        PRO
      </span>
      {roleLabel ? ` - ${roleLabel}` : ''}
    </p>
  )
}
