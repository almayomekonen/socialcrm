import Icon from '@/lib/Icon'

/**
 * The subscription card's footer band: which payment method gets charged.
 *
 * It names the holder of the card, not the card. Brand, last four digits and
 * expiry are stored nowhere in this system — `subscriptions` has no card
 * columns and the Grow webhook persists only a transaction id
 * (app/api/payments/grow/route.ts) — so any digits rendered here would be
 * invented. Showing a paying customer a card that is not theirs is the one
 * mistake the care charter treats as unrecoverable, so the row answers the
 * question at the resolution the data actually supports.
 *
 * No CTA, deliberately: there is no change-card flow to send anyone to. The
 * manage-plan modal only cancels and resumes, so an "עדכון אמצעי תשלום" link
 * would be a dead end. When card capture lands, the details and the action
 * belong here together.
 */
export default function PaymentMethodRow() {
  return (
    <div className='flex items-center gap-4 border-t border-gray-100 px-6 py-4'>
      <Icon name='credit-card' type='reg' className='size-5 shrink-0 bg-gray-400' />
      <div className='min-w-0'>
        <p className='text-sm text-gray-800'>אמצעי התשלום שמור אצל ספק הסליקה</p>
        <p className='mt-0.5 text-xs text-gray-500'>החיוב הבא ייגבה מהכרטיס ששימש לתשלום האחרון</p>
      </div>
    </div>
  )
}
