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
      {/* The deal form follows the interface language (Phase E2): the dialog declares it. */}
      <ModalPop open={open} onClose={close} label={t('deals.form.closeDealDialog')} translated>
        <SaleForm
          props={formProps}
          curSale={{ clientId, clientData: clientName } as any}
          onClose={close}
        />
      </ModalPop>
    </>
  )
}
