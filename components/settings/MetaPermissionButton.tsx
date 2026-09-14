'use client'

import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { wait } from '@/lib/funcs'

/**
 * Starts Meta's consent screen for one feature's permissions. Same mechanics as
 * the "חבר חשבון פייסבוק" button in FacebookConnect: a full-page navigation to
 * the OAuth route (never a client fetch — the route redirects to facebook.com),
 * with the pending state held while the browser leaves.
 */
export default function MetaPermissionButton({
  href,
  lbl,
  variant,
}: {
  href: string
  lbl: string
  variant?: 'outline'
}) {
  const { loading, run } = useAction()

  return (
    <Btn
      lbl={loading ? 'מעביר לפייסבוק...' : lbl}
      icon={loading ? 'spinner' : 'facebook'}
      iconClassName={loading ? 'animate-spin' : undefined}
      variant={variant}
      size='small'
      className='w-fit'
      disabled={loading}
      onClick={() =>
        run(async () => {
          window.location.href = href
          await wait(30_000)
        })
      }
    />
  )
}
