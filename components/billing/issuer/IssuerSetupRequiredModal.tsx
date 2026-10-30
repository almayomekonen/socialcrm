'use client'

import { Btn } from '@/lib/btns/Btn'
import ModalPop from '@/lib/modals/ModalPop'
import { useT } from '@/lib/i18n/I18nProvider'

export default function IssuerSetupRequiredModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const t = useT()
  return (
    <ModalPop open={open} pos='middle' onClose={onClose} label={t('billing.issuer.setup.label')} className='w-[460px] max-w-[92vw]' translated>
      <div className='pt-2 grid gap-6'>
        <div className='grid gap-2.5'>
          <h2 className='text-xl font-bold text-dark'>{t('billing.issuer.setup.heading')}</h2>
          <p className='text-base text-gray-600 leading-relaxed'>
            {t('billing.issuer.setup.body')}
            <br />
            {t('billing.issuer.setup.adminOnly')}
          </p>
        </div>
        <div className='flex justify-end'>
          <Btn lbl={t('billing.issuer.setup.ok')} onClick={onClose} variant='outline' />
        </div>
      </div>
    </ModalPop>
  )
}
