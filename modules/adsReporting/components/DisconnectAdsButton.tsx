'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { disconnectAdsReporting } from '../actions'
import { useT } from '@/lib/i18n/I18nProvider'

/** Destructive, confirmed, low visual weight — same pattern as "נתק דף" in FacebookConnect. */
export default function DisconnectAdsButton() {
  const t = useT()
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const { loading, run } = useAction()

  return (
    <>
      <Btn
        lbl={loading ? t('performance.ads.disconnect.working') : t('performance.ads.disconnect.button')}
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
            toast('success', t('performance.ads.disconnect.done'))
            router.refresh()
          })
        }}
        msg={t('performance.ads.disconnect.confirm')}
        translated
      />
    </>
  )
}
