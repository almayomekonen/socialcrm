'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import ModalPop from '@/lib/modals/ModalPop'
import SaleForm from '@/components/sales/saleForm/SaleForm'
import { useT } from '@/lib/i18n/I18nProvider'

export default function CloseDealBtn({ clientId, clientName, formProps }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <>
      <Btn lbl={t('leadDetail.header.closeDeal')} icon='money-check-dollar-pen' onClick={() => setOpen(true)} />
      {/* The deal form (components/sales, Phase E) is still Hebrew: its dialog stays an untranslated one. */}
      <ModalPop open={open} onClose={close} label='סגירת עסקה'>
        <SaleForm
          props={formProps}
          curSale={{ clientId, clientData: clientName } as any}
          onClose={close}
        />
      </ModalPop>
    </>
  )
}
