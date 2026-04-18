'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import ModalPop from '@/lib/modals/ModalPop'
import SaleForm from '@/components/sales/saleForm/SaleForm'

export default function CloseDealBtn({ clientId, clientName, formProps }) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <>
      <Btn lbl='סגור עסקה' icon='money-check-dollar-pen' onClick={() => setOpen(true)} />
      <ModalPop open={open} onClose={close}>
        <SaleForm
          props={formProps}
          curSale={{ clientId, clientData: clientName } as any}
          onClose={close}
        />
      </ModalPop>
    </>
  )
}
