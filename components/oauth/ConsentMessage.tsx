import { Btn } from '@/lib/btns/Btn'

type Props = { message: string; showBilling?: boolean }

/** Consent cannot continue: say why in plain words and offer one way forward. */
export default function ConsentMessage({ message, showBilling = false }: Props) {
  return (
    <div className='mx-auto mt-16 max-w-md px-4'>
      <div className='rounded-lg border border-gray-200 bg-white p-6 flex flex-col gap-4'>
        <h1 className='text-lg font-bold'>חיבור ChatGPT</h1>
        <p className='text-sm text-gray-600'>{message}</p>
        <div className='mt-auto flex items-center justify-end gap-3'>
          <Btn href='/dashboard' lbl='חזרה ל-SocialCRM' variant='outline' />
          {showBilling ? <Btn href='/settings/update_payment' lbl='לניהול המנוי' /> : null}
        </div>
      </div>
    </div>
  )
}
