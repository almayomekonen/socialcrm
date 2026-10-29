'use client'

import { useState } from 'react'
import SalesTable from './salesTable/SalesTable'
import ModalPop from '../../lib/modals/ModalPop'
import SaleForm from './saleForm/SaleForm'
import { useT } from '@/lib/i18n/I18nProvider'

export default function SalesSection({ props }) {
  const t = useT()
  const [openForm, setOpenForm] = useState(false)
  const [curSale, setCurSale] = useState(null)

  return (
    <>
      <SalesTable props={{ ...props, setCurSale, setOpenForm, curSale }} key={JSON.stringify(props.data)} />

      <ModalPop open={openForm} label={t('deals.page.formDialog')} translated onClose={() => (setOpenForm(false), setCurSale(null))}>
        <SaleForm props={props.formProps} curSale={curSale} onClose={() => (setOpenForm(false), setCurSale(null))} />
      </ModalPop>
    </>
  )
}
