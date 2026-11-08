import { Btn } from '@/lib/btns/Btn'
import type { PurchaseOutcome } from '@/lib/credits/purchaseOutcome'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * The result of the latest purchase, and the way back to WhatsApp. Rendered from
 * the server's billing row, so a reload or a closed browser shows the truth.
 */
export default function CreditPurchaseStatus({ outcome, whatsappHref, hasCredits, locale }: { outcome: PurchaseOutcome; whatsappHref: string | null; hasCredits: boolean; locale: UiLocale }) {
  const t = translatorFor(locale)
  const card = 'mt-6 flex max-w-3xl flex-col gap-3 rounded-lg border border-gray-200 bg-white p-6'
  const back = t('settings.payment.credits.returnWhatsapp')
  if (outcome?.state === 'success') {
    return (
      <div role='status' className={card}>
        <h1 className='text-xl font-bold text-dark'>{t('settings.payment.credits.successTitle')}</h1>
        <p className='text-sm text-gray-700'>{t('settings.payment.credits.successBody', { credits: String(outcome.credits ?? '') })}</p>
        {whatsappHref && <Btn variant='solid' size='large' lbl={back} href={whatsappHref} className='w-full justify-center' />}
      </div>
    )
  }
  if (outcome?.state === 'confirming') {
    return (
      <div role='status' className={card}>
        <h1 className='text-xl font-bold text-dark'>{t('settings.payment.credits.confirmingTitle')}</h1>
        <p className='text-sm text-gray-700'>{t('settings.payment.credits.confirmingBody')}</p>
        <Btn variant='outline' size='large' lbl={t('settings.payment.credits.checkAgain')} href='/billing/credits' className='w-full justify-center' />
      </div>
    )
  }
  if (outcome?.state === 'declined') {
    return (
      <div role='status' className={card}>
        <p className='text-sm text-red-700'>{t('settings.payment.credits.declinedBody')}</p>
      </div>
    )
  }
  if (hasCredits && whatsappHref) {
    return (
      <div className={card}>
        <Btn variant='outline' size='large' lbl={back} href={whatsappHref} className='w-full justify-center' />
      </div>
    )
  }
  return null
}
