'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { disconnectAdsReporting } from '../actions'

/** Destructive, confirmed, low visual weight — same pattern as "נתק דף" in FacebookConnect. */
export default function DisconnectAdsButton() {
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const { loading, run } = useAction()

  return (
    <>
      <Btn
        lbl={loading ? 'מנתק...' : 'נתק חשבון מודעות'}
        icon={loading ? 'spinner' : undefined}
        iconClassName={loading ? 'animate-spin' : undefined}
        variant='destructive'
        size='small'
        className='w-fit'
        disabled={loading}
        onClick={() => setConfirm(true)}
      />
      <ConfirmPop
        open={confirm}
        destructive
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          run(async () => {
            await disconnectAdsReporting()
            toast('success', 'חשבון המודעות נותק והגישה השמורה נמחקה')
            router.refresh()
          })
        }}
        msg='לנתק את חשבון המודעות? הגישה השמורה תימחק מ-SocialCRM, ולא ניתן יהיה לראות כאן ביצועי מודעות עד לחיבור מחדש.'
      />
    </>
  )
}
