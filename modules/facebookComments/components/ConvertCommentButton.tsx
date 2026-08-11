'use client'

import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import { convertCommentToLead } from '../actions'

/**
 * "צור ליד" for one comment. Pending state is local to this button — the rest
 * of the list stays usable (frontend-experience §7).
 *
 * Failures are named, not generic: a rep who hits the quota needs to know that,
 * not "something went wrong". No raw error text ever reaches here; the action
 * returns typed reasons.
 */
const FAILURE_COPY: Record<string, string> = {
  not_found: 'התגובה לא נמצאה',
  deleted: 'התגובה נמחקה בפייסבוק ולא ניתן להמיר אותה',
  not_enabled: 'התכונה אינה זמינה בחשבון הזה',
  quota_exceeded: 'הגעת למכסת הלידים בחבילה הנוכחית',
  create_failed: 'לא ניתן ליצור ליד מהתגובה',
  db_error: 'לא ניתן ליצור ליד מהתגובה. נסה שוב.',
}

export default function ConvertCommentButton({ commentId }: { commentId: string }) {
  const router = useRouter()
  const { loading, run } = useAction()

  return (
    <Btn
      lbl={loading ? 'יוצר ליד...' : 'צור ליד'}
      icon={loading ? 'spinner' : undefined}
      iconClassName={loading ? 'animate-spin' : undefined}
      variant='outline'
      size='small'
      className='w-fit'
      disabled={loading}
      onClick={() =>
        run(async () => {
          const result = await convertCommentToLead(commentId)
          if (result.ok) {
            toast('success', 'הליד נוצר בהצלחה')
            router.refresh()
            return
          }
          // `in` rather than narrowing on `result.ok`: the repo compiles with
          // strictNullChecks:false, which disables discriminated-union
          // narrowing on a boolean discriminant. This is the same shape the
          // codebase already uses for upsertLead's `'error' in lead` result.
          const reason = 'reason' in result ? result.reason : undefined
          toast('error', (reason && FAILURE_COPY[reason]) || FAILURE_COPY.create_failed)
        })
      }
    />
  )
}
