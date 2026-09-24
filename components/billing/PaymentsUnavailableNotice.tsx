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
 *
 * `hasAccess` exists because "your access is unaffected" is a lie to an account
 * that has none — a never-started trial has no CRM access at all, and telling
 * that customer nothing has changed would be the opposite of reassuring.
 */
export default function PaymentsUnavailableNotice({ action, hasAccess }: { action: 'start' | 'update'; hasAccess: boolean }) {
  return (
    <div role='status' dir='rtl' className='max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3'>
      <Icon name='circle-exclamation' className='bg-amber-700 size-5 mt-0.5 shrink-0' />
      <div className='space-y-1 text-sm'>
        <p className='font-semibold text-amber-900'>
          {action === 'start' ? 'לא ניתן להוסיף אמצעי תשלום כרגע' : 'לא ניתן לעדכן את אמצעי התשלום כרגע'}
        </p>
        <p className='text-amber-800'>
          {hasAccess
            ? 'מערכת התשלומים אינה זמינה זמנית. הגישה שלך למערכת לא נפגעת, ולא בוצע חיוב.'
            : 'מערכת התשלומים אינה זמינה זמנית, ולכן לא ניתן להפעיל כרגע את הגישה למערכת. לא בוצע חיוב.'}
        </p>
        <p className='text-amber-800'>אפשר לנסות שוב מאוחר יותר, או לפנות אלינו ונטפל בזה.</p>
      </div>
    </div>
  )
}
