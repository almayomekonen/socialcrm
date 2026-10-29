'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { leadSources } from '@/types/lists'
import { userType } from '@/types/types'
import { Btn } from '@/lib/btns/Btn'
import { isPrdctsExists, insertSale } from '@/actions/saleForm'
import ClientDataForm from './ClientDataForm'
import SaleDetailsFields from './SaleDetailsFields'
import ProductFields from './ProductFields'
import Title from '@/lib/Title'
import { hasSaleOnClient, saleValidationError } from './funcs'
import { DealsView } from '@/types/db/tables'
import { api } from '@/lib/funcs'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { SubmitButton } from '@/lib/btns/SubmitBtn'
import { omitOffice, omitOfficeExt } from '@/lib/funcs'
import { getObjFormData } from '@/lib/form/funcs'
import ConfirmPop from '@/lib/modals/ConfirmPop'

export { getUserDefault } from './funcs'

type Props = {
  props: {
    user: any
    officeGotPerm: userType[]
    allUsersNoOffice: any[]
    allUsers: any[]
  }
  curSale?: DealsView 
  onClose: () => void
}

export default function SaleForm({ props, curSale, onClose }: Props) {
  const { user, officeGotPerm, allUsers } = props
  const router = useRouter()
  /**
   * PRE-GATE. `insertSale` is requireProductAccess-guarded and the submit runs
   * through `api()`, which catches everything into a generic error toast — so
   * closing a deal on a lapsed subscription looked like a broken form. One
   * gate here covers all three entries (leads table, lead page, sales section)
   * and no doomed request is sent.
   */
  const expired = useAccessDenied()

  const allReps = omitOfficeExt(allUsers)
  const allRepsWithExt = omitOffice(allUsers)

  const [isAsignUser, setIsAsignUser] = useState(curSale?.action === 'הצטרפות')
  const [otherSource, setOtherSource] = useState(curSale?.leadSource && !leadSources.includes(curSale.leadSource))
  const [share, setShare] = useState(Boolean(curSale?.userIds?.[1]))
  const [prdctExistsConfirm, setPrdctExistsConfirm] = useState<{ sale: any; msg: string } | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const formRef = useRef(null)

  const reset = () => {
    onClose()
    formRef.current.reset()
  }

  const [prdcts, setPrdcts] = useState([{}])

  useEffect(() => {
    if (prdcts.length > 1) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
    }
  }, [prdcts, curSale?.id])

  async function handleSave(e) {
    const sale = getObjFormData(e)
    console.log('sale', sale)

    const invalid = saleValidationError(sale)
    if (invalid) return setErrMsg(invalid)

    const toReturn = await hasSaleOnClient({ sale });
    if (!toReturn) return

    if (curSale?.id) {
      sale.saleId = curSale.id
      sale.rwrd = curSale.bonus as any
    }

    if (sale.clientId) {
      const productExists = await isPrdctsExists(sale)
      if (productExists) {
        setPrdctExistsConfirm({ sale, msg: productExists })
        return
      }
    }

    saveSale(sale)
  }

  async function saveSale(sale: any) {
    const res = await api(insertSale, sale, curSale?.id ? 'העסקה עודכנה בהצלחה' : 'העסקה נוספה בהצלחה')
    if (res?.err) return
    reset()
    router.push('/deals')
  }

  function onPrdctExistsConfirm() {
    const pending = prdctExistsConfirm
    setPrdctExistsConfirm(null)
    if (!pending) return
    saveSale(pending.sale)
  }

  function addProduct() {
    setPrdcts([...prdcts, {}])
  }

  function removeProduct(indexToRemove) {
    if (prdcts.length <= 1) return
    setPrdcts(prdcts.filter((_, i) => i !== indexToRemove))
  }

  if (expired) {
    return <SubscriptionExpiredState mode='panel' source='close_deal' feature='חידוש המנוי מחזיר את סגירת העסקאות.' />
  }

  return (
    <form ref={formRef} onSubmit={handleSave} className='max-w-3xl'>
      <Title
        lbl={curSale?.id ? 'עריכת עסקה' : 'עסקה חדשה'}
        icon='money-check-dollar-pen'
        className='w-full border-gray-200'
        iconClassName='size-7'
      />

      <SaleDetailsFields
        user={user}
        officeGotPerm={officeGotPerm}
        allUsers={allUsers}
        allReps={allReps}
        allRepsWithExt={allRepsWithExt}
        curSale={curSale}
        share={share}
        setShare={setShare}
        isAsignUser={isAsignUser}
        setIsAsignUser={setIsAsignUser}
        otherSource={otherSource}
        setOtherSource={setOtherSource}
      />

      {/* SECTION 2: Client Data */}
      <ClientDataForm curSale={curSale} />

      {/* SECTION 3: Products */}
      <section>
        {prdcts.map((p, i) => (
          <ProductFields key={i} i={i} isAsignUser={isAsignUser} curSale={curSale} />
        ))}
        <div className='flex gap-4'>
          <Btn lbl='מוצר נוסף' icon='plus' variant='outline' onClick={addProduct} type='button' />
          {prdcts.length > 1 && (
            <Btn lbl='הסרת מוצר' icon='trash' variant='outline' onClick={() => removeProduct(prdcts.length - 1)} type='button' />
          )}
        </div>
      </section>

      {/* SECTION 4: Submission Button */}
      <SubmitButton className='w-full mt-8' />

      <ConfirmPop
        open={!!prdctExistsConfirm}
        onClose={() => setPrdctExistsConfirm(null)}
        onConfirm={onPrdctExistsConfirm}
        msg={prdctExistsConfirm?.msg ?? ''}
      />

      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
      />
    </form>
  )
}
