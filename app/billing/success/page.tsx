import type { Metadata } from 'next'
import { CheckCircle } from 'lucide-react'
import { Btn } from '@/lib/btns/Btn'

export const metadata: Metadata = { title: 'התשלום בוצע' }

export default function BillingSuccessPage() {
  return (
    <main className='min-h-screen flex items-center justify-center bg-gray-50 px-4'>
      <meta httpEquiv='refresh' content='5;url=/settings/update_payment' />
      <div className='w-full max-w-[420px] flex flex-col items-center gap-5 rounded-xl border border-gray-200 bg-white shadow-sm px-6 py-8'>
        <CheckCircle className='size-10 text-green-500' strokeWidth={2} />

        <div className='flex flex-col gap-1 text-center'>
          <h1 className='text-lg font-semibold leading-snug'>התשלום התקבל בהצלחה</h1>
          <p className='text-sm font-medium text-gray-700'>ברוך הבא למסלול Pro</p>
        </div>

        <p className='text-sm text-gray-600 text-center whitespace-pre-line leading-relaxed'>
          {'השדרוג שלך התקבל בהצלחה.\nייתכן עיכוב של מספר שניות עד שהשדרוג יופיע במערכת.'}
        </p>

        <p className='text-xs text-gray-500 text-center'>העמוד יתעדכן אוטומטית בעוד מספר שניות</p>

        <Btn variant='solid' href='/settings/update_payment' lbl='המשך למערכת' className='w-full' />

        <p className='text-xs text-gray-500 text-center'>רענן אם אינך רואה את השדרוג</p>
      </div>
    </main>
  )
}
