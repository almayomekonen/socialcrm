'use client'

import { useEffect, useRef, useState } from 'react'
import {
  BRANCHES,
  COMPANIES,
  leadSources,
  prdctOptByBranch,
  prdctOptByBranchAsignUser,
  STATUS_LIST,
} from '@/types/lists'
import Collab from './Collab'
import { userType } from '@/types/types'
import { Btn } from '@/lib/btns/Btn'
import { isPrdctsExists, insertSale } from '@/actions/saleForm'
import ClientDataForm from './ClientDataForm'
import Title from '@/lib/Title'
import { isPayExist, isAmountHigh, isSameUser, hasSaleOnClient } from './funcs'
import { SalesView } from '@/types/db/tables'
import { api } from '@/lib/funcs'
import { SubmitButton } from '@/lib/btns/SubmitBtn'
import { omitOffice, omitOfficeExt } from '@/lib/funcs'
import Fieldset from '@/lib/Fieldset'
import { Checkbox, Input, Select } from '@/lib/form'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { getObjFormData } from '@/lib/form/funcs'
import AccordionItem from '@/lib/AccordionItem'

type Props = {
  props: {
    user: any
    officeGotPerm: userType[]
    allUsersNoOffice: any[]
    allUsers: any[]
  }
  curSale?: SalesView
  onClose: () => void
}

export default function SaleForm({ props, curSale, onClose }: Props) {
  const { user, officeGotPerm, allUsers } = props

  const allAgents = omitOfficeExt(allUsers)
  const allAgentsWithExt = omitOffice(allUsers)

  const [isAsignUser, setIsAsignUser] = useState(curSale?.action === 'הצטרפות')
  const [otherSource, setOtherSource] = useState(curSale?.leadSource && !leadSources.includes(curSale.leadSource))
  const [share, setShare] = useState(Boolean(curSale?.userIds[1]))

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

    if (!sale.users?.userId) return alert('שגיאה, יש לבחור סוכן')

    if (!sale.clientId) return alert('שגיאה, יש לבחור לקוח')

    if (isPayExist(sale)) return alert('שגיאה, יש למלא סכום לפחות למוצר אחד')

    if (isAmountHigh(sale.prdcts)) return alert('שגיאה, סכום המכירה גבוה מדי')

    if (isSameUser(sale.users)) return alert('שגיאה, לא ניתן לבצע שת"פ עם אותו הסוכן')

    const toReturn = await hasSaleOnClient({ sale }) //clientbelongsToUser({ sale, allAgents })
    if (!toReturn) return

    if (curSale?.id) {
      sale.saleId = curSale.id
      sale.rwrd = curSale.rwrd as any
    }

    if (sale.clientId) {
      const productExists = await isPrdctsExists(sale)
      if (productExists) {
        const ok = confirm(productExists)
        if (!ok) return
      }
    }

    api(insertSale, sale)
    reset()
  }

  function addProduct() {
    setPrdcts([...prdcts, {}])
  }

  function removeProduct(indexToRemove) {
    if (prdcts.length <= 1) return
    setPrdcts(prdcts.filter((_, i) => i !== indexToRemove))
  }

  return (
    <form ref={formRef} onSubmit={handleSave} className='max-w-3xl'>
      <Title
        lbl={curSale ? 'עריכת עסקה' : 'עסקה חדשה'}
        icon='money-check-dollar-pen'
        className='w-full border-gray-200'
        iconClassName='size-7'
      />

      {/* SECTION: Users Details */}
      <section>
        <div className='my-6 flex gap-3 items-end'>
          {share ? (
            <>
              <Collab
                officeGotPerm={officeGotPerm}
                allAgentsWithExt={allAgentsWithExt}
                allAgents={allAgents}
                user={user}
                curSale={curSale}
              />
              <div>
                <Btn
                  href='/settings/self_edit?tab=ext_users'
                  variant='outline'
                  size='small'
                  lbl='הוספת שותף חיצוני'
                  type='button'
                  className=' h-7 text-xs mb-1'
                />
                <Btn lbl='בטל שת"פ' icon='trash' onClick={() => setShare(false)} variant='outline' type='button' />
              </div>
            </>
          ) : (
            <>
              <SelectSearch
                name='users.userId'
                options={user.role === 'OFFICE' ? officeGotPerm : allAgents}
                placeholder='חיפוש נציג...'
                lbl='נציג מכירות'
                className='w-52'
                selected={getUserDefault(curSale, user, officeGotPerm)}
              />
              <Btn lbl='שת"פ' icon='plus' onClick={() => setShare(true)} variant='outline' type='button' />
            </>
          )}
        </div>

        {/* SECTION: Sale Details */}
        <div className='grid grid-cols-3 items-end gap-4 mb-8 mobile:gap-4 mobile:grid'>
          <div>
            <p className='lbl mb-1'>סוג עסקה</p>
            <Select
              name='action'
              options={['מכירה', 'הצטרפות']}
              className='mobile:w-full'
              onChange={(e) => setIsAsignUser(e.target.value === 'הצטרפות')}
              value={isAsignUser ? 'הצטרפות' : 'מכירה'}
            />
          </div>
          <Input
            lbl='תאריך פנייה'
            name='offrDt'
            type='date'
            className='mobile:w-full'
            defaultValue={curSale?.offrDt || (new Date() as any)}
          />
          <SelectSearch name='handlerId' options={allUsers} lbl='אחראי עסקה' selected={curSale?.handlerId || user?.id} />
          <section>
            <div className='flex gap-2 justify-between'>
              <p className='mb-1 ms-1 lbl'>מקור</p>
              <label className='mb-1 ms-1 flex gap-2 cursor-pointer'>
                <input
                  type='checkbox'
                  onChange={() => {
                    setOtherSource(!otherSource)
                  }}
                  className='size-3 accent-solid'
                  checked={otherSource || false}
                />
                <p className='lbl'>אחר</p>
              </label>
            </div>
            <div className='inline-flex items-center gap-1 rounded-md border border-gray-200 w-auto'>
              {otherSource ? (
                <Input
                  name='leadSource'
                  placeholder='הקלד מקור אחר'
                  className='w-52 h-10 border-0'
                  defaultValue={curSale?.leadSource}
                />
              ) : (
                <Select
                  name='leadSource'
                  options={leadSources}
                  placeholder='בחירת מקור'
                  required={false}
                  className='w-52 border-0'
                  defaultValue={curSale?.leadSource}
                />
              )}
            </div>
          </section>
        </div>
      </section>

      {/* SECTION 2: Client Data */}
      <ClientDataForm curSale={curSale} />

      {/* SECTION 3: Products */}
      <section>
        {prdcts.map((p, i) => (
          <PrdctComp key={i} i={i} isAsignUser={isAsignUser} curSale={curSale} />
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
    </form>
  )
}

export function getUserDefault(curSale, user, officeGotPerm) {
  if (curSale?.userIds?.[0]) return curSale?.userIds?.[0]
  else return user.role === 'OFFICE' ? officeGotPerm[0]?.id : user?.id
}

function PrdctComp({ i, isAsignUser, curSale }: { i: number; isAsignUser: boolean; curSale?: SalesView }) {
  const curLists = isAsignUser ? prdctOptByBranchAsignUser[curSale?.branch] : prdctOptByBranch[curSale?.branch]

  const [prdct, setPrdct] = useState({
    prdctList: curLists?.prdctList,
    prdctTypeList: curLists?.prdctTypeList,
    branch: curSale?.branch,
  })
  useEffect(() => {
    setPrdct(
      isAsignUser
        ? prdctOptByBranchAsignUser[branchRef.current?.value]
        : { ...prdctOptByBranch[branchRef.current?.value], branch: branchRef.current?.value },
    )
  }, [isAsignUser])

  useEffect(() => {
    setPrdct(
      isAsignUser
        ? prdctOptByBranchAsignUser[branchRef.current.value]
        : { ...prdctOptByBranch[branchRef.current.value], branch: branchRef.current.value },
    )
    setPrdct(
      isAsignUser
        ? prdctOptByBranchAsignUser[branchRef.current?.value]
        : { ...prdctOptByBranch[branchRef.current?.value], branch: branchRef.current?.value },
    )
  }, [isAsignUser])

  const branchRef = useRef(null)

  const prefix = `prdcts[${i}]`

  return (
    <Fieldset legend={`מוצר ${i + 1}`} className='mt-8 mb-4 border p-4 rounded-lg'>
      <div className='grid grid-cols-3 gap-x-8 gap-y-6 relative mobile:grid-cols-2 mobile:w-full mobile:gap-4'>
        <Select lbl='ספק' name={`${prefix}.company`} options={COMPANIES} required defaultValue={curSale?.company} />
        <Select
          lbl='קטגוריה'
          name={`${prefix}.branch`}
          ref={branchRef}
          options={BRANCHES}
          onChange={(e) =>
            setPrdct(
              isAsignUser
                ? prdctOptByBranchAsignUser[e.target.value]
                : { branch: e.target.value, ...prdctOptByBranch[e.target.value] },
            )
          }
          required
          defaultValue={curSale?.branch}
        />
        <Select lbl='מוצר / שירות' name={`${prefix}.prdct`} options={prdct.prdctList} required defaultValue={curSale?.prdct} />
        {prdct.prdctTypeList?.length > 1 && prdct.branch !== 'אלמנטרי' ? (
          prdct.prdctTypeList.map((prdctType) => (
            <Input
              dir='ltr'
              required={false}
              key={prdctType}
              lbl={'סכום ' + prdctType}
              name={`${prefix}.${prdctType}`}
              type='number'
              defaultValue={curSale?.prdctType === prdctType ? curSale?.amount : ''}
            />
          ))
        ) : (
          <>
            <Select
              lbl='סוג עסקה'
              name={`${prefix}.prdctType`}
              options={prdct.prdctTypeList}
              defaultValue={curSale?.prdctType}
            />
            <Input lbl='סכום עסקה' name={`${prefix}.amount`} type='number' defaultValue={curSale?.amount} />

            {prdct.branch === 'אלמנטרי' && (
              <>
                <Input lbl='מספר עוסק' name={`${prefix}.bizNum`} type='number' defaultValue={curSale?.bizNum} required={false} />
                <Input lbl='שם עסק' name={`${prefix}.bizName`} defaultValue={curSale?.bizName} required={false} />
              </>
            )}
          </>
        )}

        <Select lbl='שלב בצנרת' name={`${prefix}.status`} options={STATUS_LIST} required defaultValue={curSale?.status} />

        <Input required={false} lbl='תאריך סגירה' name={`${prefix}.saleDt`} type='date' defaultValue={curSale?.saleDt} />
        <span className='col-span-3 mobile:col-span-2'>
          <div className='accordion'>
            <AccordionItem title='הערות'>
              <Input
                className='border-none outline-none focus:border-none focus:outline-none'
                as='textarea'
                name={`${prefix}.notes`}
                required={false}
                defaultValue={curSale?.notes}
              />
            </AccordionItem>
          </div>
        </span>
      </div>
    </Fieldset>
  )
}
