'use client'

import { useEffect, useRef, useState } from 'react'
import { BRANCHES, COMPANIES, prdctOptByBranch, prdctOptByBranchAsignUser, STATUS_LIST, normalizeStatus } from '@/types/lists'
import { DealsView } from '@/types/db/tables'
import Fieldset from '@/lib/Fieldset'
import { Input, Select } from '@/lib/form'
import AccordionItem from '@/lib/AccordionItem'

/** One product of the deal form (`prdcts[i].*`): supplier, category, product, amount, stage, closing date, notes. */
export default function PrdctComp({ i, isAsignUser, curSale }: { i: number; isAsignUser: boolean; curSale?: DealsView }) {
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
        <Select lbl='ספק' name={`${prefix}.company`} options={COMPANIES} required={false} defaultValue={curSale?.company} />
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
          required={false}
          defaultValue={curSale?.branch}
        />
        <Select lbl='מוצר / שירות' name={`${prefix}.prdct`} options={prdct.prdctList} required={false} defaultValue={curSale?.prdct} />
        {false && prdct.prdctTypeList?.length > 1 && prdct.branch !== 'אלמנטרי' ? (
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
            {/* prdctType hidden — SocialCRM simplified flow. Kept mounted so default submits. */}
            <div className='hidden'>
              <Select
                lbl='סוג עסקה'
                name={`${prefix}.prdctType`}
                options={prdct.prdctTypeList}
                defaultValue={curSale?.prdctType}
              />
            </div>
            <Input lbl='סכום עסקה' name={`${prefix}.amount`} type='number' defaultValue={curSale?.amount} />

            {/* bizNum / bizName hidden — insurance-era fields. */}
            <div className='hidden'>
              {prdct.branch === 'אלמנטרי' && (
                <>
                  <Input lbl='מספר עוסק' name={`${prefix}.bizNum`} type='number' defaultValue={curSale?.bizNum} required={false} />
                  <Input lbl='שם עסק' name={`${prefix}.bizName`} defaultValue={curSale?.bizName} required={false} />
                </>
              )}
            </div>
          </>
        )}

        <Select lbl='שלב בצנרת' name={`${prefix}.status`} options={STATUS_LIST} required defaultValue={normalizeStatus(curSale?.status)} />

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
