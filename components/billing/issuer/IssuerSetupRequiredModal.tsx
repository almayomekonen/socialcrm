'use client'

import { Btn } from '@/lib/btns/Btn'
import ModalPop from '@/lib/modals/ModalPop'

export default function IssuerSetupRequiredModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <ModalPop open={open} pos='middle' onClose={onClose} label='השלמת פרטי עסק' className='w-[460px] max-w-[92vw]'>
      <div className='pt-2 grid gap-6'>
        <div className='grid gap-2.5'>
          <h2 className='text-xl font-bold text-dark'>צריך להשלים קודם פרטי עסק</h2>
          <p className='text-base text-gray-600 leading-relaxed'>
            לפני הנפקת החשבונית הראשונה צריך להוסיף את פרטי העסק.
            <br />
            רק מנהל החשבון יכול לעשות את זה — אפשר לפנות אליו כדי להמשיך.
          </p>
        </div>
        <div className='flex justify-end'>
          <Btn lbl='הבנתי' onClick={onClose} variant='outline' />
        </div>
      </div>
    </ModalPop>
  )
}
