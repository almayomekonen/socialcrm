'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'
import { useT } from '@/lib/i18n/I18nProvider'
import { buyCreditPack } from '@/actions/credits'
import type { PackKind } from '@/lib/credits/config'
import type { MessageKey } from '@/lib/i18n/translate'

const RESULT: Record<string, MessageKey> = {
  granted: 'settings.payment.credits.result.granted',
  already_granted: 'settings.payment.credits.result.already_granted',
  declined: 'settings.payment.credits.result.declined',
  pending_confirmation: 'settings.payment.credits.result.pending_confirmation',
  in_progress: 'settings.payment.credits.result.in_progress',
  refused: 'settings.payment.credits.result.refused',
  card_declined: 'settings.payment.credits.result.card_declined',
  purchase_pending: 'settings.payment.credits.result.purchase_pending',
}

/**
 * One pack: a button, then an explicit confirmation naming the amount and that
 * it is a one-time charge. Nothing is charged before "confirm". The request key
 * is minted when the dialog opens and reused by every submit of THAT dialog, so
 * a double click charges once.
 */
export default function CreditPackButton({
  kind,
  credits,
  price,
}: {
  kind: PackKind
  credits: number
  price: string
}) {
  const t = useT()
  const router = useRouter()
  const [requestKey, setRequestKey] = useState<string | null>(null)

  async function confirm() {
    if (!requestKey) return
    const res = await buyCreditPack({ kind, requestKey })
    setRequestKey(null)
    const ok = res.state === 'granted' || res.state === 'already_granted'
    const pending = res.state === 'pending_confirmation' || res.state === 'in_progress'
    const specific = 'reason' in res && (res.reason === 'card_declined' || res.reason === 'purchase_pending') ? res.reason : res.state
    toast(ok ? 'success' : pending ? 'message' : 'error', t(RESULT[specific] ?? RESULT.refused))
    router.refresh()
  }

  return (
    <>
      <Btn
        variant='outline'
        size='small'
        className='w-fit'
        lbl={t('settings.payment.credits.buy', { credits: String(credits), price })}
        onClick={() => setRequestKey(crypto.randomUUID())}
      />
      <ConfirmPop
        open={requestKey !== null}
        onClose={() => setRequestKey(null)}
        onConfirm={confirm}
        msg={t('settings.payment.credits.confirm', { price, credits: String(credits) })}
        confirmLbl={t('settings.payment.credits.confirmLbl', { price })}
      />
    </>
  )
}
