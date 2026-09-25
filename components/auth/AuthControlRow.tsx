'use client'

import Link from 'next/link'

/**
 * AuthControlRow — the single control row shared by `/auth` and `/auth/register`.
 *
 * Lumen puts exactly one row in this slot on BOTH `/signin` and `/signup`
 * (`_reference/lumen-nextjs-template-1.0.0/src/app/{signin,signup}/page.tsx`),
 * with identical geometry:
 *
 *   flex items-center justify-between
 *     ├ flex items-center gap-1.5          → Checkbox + Label
 *     └ text-sm font-medium hover:underline → Link
 *
 * Lumen fills it with remember-me + forgot-password on signin, and the terms
 * checkbox + terms link on signup. Both go through THIS component, so the row's
 * position, typography, spacing and alignment are defined once and the two
 * screens cannot drift apart — only the copy and the action differ.
 *
 * The checkbox deliberately carries NO `name`. Both forms serialise through
 * `new FormData(form)`, which collects only named controls, so this row cannot
 * change the payload reaching `sendToken` or `addAgency`.
 *
 * `checkboxRequired` is opt-in per screen, and only the signup row sets it.
 * Grow's site-approval checklist requires the customer to actively accept the
 * terms before proceeding, and until now this checkbox accepted nothing: no
 * name, no required, no state — it rendered, and submitting past it untouched
 * worked. Sign-in's remember-me must stay optional, hence the prop rather than
 * a blanket change.
 *
 * Visual spec (size-4 · rounded-[4px] · border-input · primary when checked)
 * is transcribed from Lumen's `checkbox.tsx` into `.auth-surface` in
 * `lib/css/auth.css`, the same way the Input and Label specs already are.
 */
type AuthControlRowProps = {
  checkboxId: string
  checkboxLabel: string
  actionLabel: string
  /** Blocks submit until ticked. Signup only; never sign-in's remember-me. */
  checkboxRequired?: boolean
} & ({ href: string; onAction?: never } | { href?: never; onAction: () => void })

export default function AuthControlRow({
  checkboxId,
  checkboxLabel,
  actionLabel,
  checkboxRequired = false,
  href,
  onAction,
}: AuthControlRowProps) {
  return (
    <div className='auth-control-row flex items-center justify-between'>
      <div className='flex items-center gap-1.5'>
        <input id={checkboxId} type='checkbox' required={checkboxRequired} aria-required={checkboxRequired || undefined} />
        <label htmlFor={checkboxId}>{checkboxLabel}</label>
      </div>
      {href ? (
        <Link href={href} className='text-sm font-medium hover:underline'>
          {actionLabel}
        </Link>
      ) : (
        <button type='button' onClick={onAction} className='text-sm font-medium hover:underline'>
          {actionLabel}
        </button>
      )}
    </div>
  )
}
