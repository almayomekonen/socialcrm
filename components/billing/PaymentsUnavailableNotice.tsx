import Icon from '@/lib/Icon'

/**
 * Shown wherever a card action would otherwise be offered while the provider
 * cannot complete one (see isCardBillingAvailable).
 *
 * Payment Links are gone, so there is no second way to pay and nothing honest
 * to offer instead. The one thing this must not do is show a button that opens
 * a setup which cannot finish — a dead end at the moment the customer is
 * trying to pay is worse than a plain "not right now".
 *
 * It never says a trial started or a payment succeeded, and it does not ask the
 * customer to do anything they cannot do.
 */
export default function PaymentsUnavailableNotice({ action }: { action: 'start' | 'update' }) {
  return (
    <div role='status' dir='rtl' className='max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3'>
      <Icon name='circle-exclamation' className='bg-amber-700 size-5 mt-0.5 shrink-0' />
      <div className='space-y-1 text-sm'>
        <p className='font-semibold text-amber-900'>
          {action === 'start' ? 'לא ניתן להוסיף אמצעי תשלום כרגע' : 'לא ניתן לעדכן את אמצעי התשלום כרגע'}
        </p>
        <p className='text-amber-800'>מערכת התשלומים אינה זמינה זמנית. הגישה שלך למערכת לא נפגעת, ולא בוצע חיוב.</p>
        <p className='text-amber-800'>אפשר לנסות שוב מאוחר יותר, או לפנות אלינו ונטפל בזה.</p>
      </div>
    </div>
  )
}
