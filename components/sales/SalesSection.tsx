'use client'

import { useState } from 'react'
import SalesTable from './salesTable/SalesTable'
import ModalPop from '../../lib/modals/ModalPop'
import SaleForm from './saleForm/SaleForm'

export default function SalesSection({ props }) {
  const [openForm, setOpenForm] = useState(false)
  const [curSale, setCurSale] = useState(null)

  return (
    <div>
      <SalesTable props={{ ...props, setCurSale, setOpenForm, curSale }} key={JSON.stringify(props.data)} />

      <ModalPop open={openForm} onClose={() => (setOpenForm(false), setCurSale(null))}>
        <SaleForm props={props.formProps} curSale={curSale} onClose={() => (setOpenForm(false), setCurSale(null))} />
      </ModalPop>
    </div>
  )
}
