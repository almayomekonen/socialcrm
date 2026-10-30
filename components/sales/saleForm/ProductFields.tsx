'use client'

import { useEffect, useRef, useState } from 'react'
import { BRANCHES, COMPANIES, prdctOptByBranch, prdctOptByBranchAsignUser, STATUS_LIST, normalizeStatus } from '@/types/lists'
import { DealsView } from '@/types/db/tables'
import Fieldset from '@/lib/Fieldset'
import { Input, Select } from '@/lib/form'
import AccordionItem from '@/lib/AccordionItem'
import { useT } from '@/lib/i18n/I18nProvider'
import { dealBranchLabel, dealCompanyLabel, dealProductLabel, dealProductTypeLabel, dealStatusLabel, labelledOptions } from '@/lib/deals/labels'

/** One product of the deal form (`prdcts[i].*`): supplier, category, product, amount, stage, closing date, notes. */
export default function PrdctComp({ i, isAsignUser, curSale }: { i: number; isAsignUser: boolean; curSale?: DealsView }) {
  const t = useT()
  const opts = (values: readonly string[] | undefined, label: Parameters<typeof labelledOptions>[1]) => labelledOptions(values ?? [], label, t.locale)
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
    <Fieldset legend={t('deals.form.product', { n: String(i + 1) })} className='mt-8 mb-4 border p-4 rounded-lg'>
      <div className='grid grid-cols-3 gap-x-8 gap-y-6 relative mobile:grid-cols-2 mobile:w-full mobile:gap-4'>
        <Select lbl={t('deals.form.company')} name={`${prefix}.company`} options={opts(COMPANIES, dealCompanyLabel)} required={false} defaultValue={curSale?.company} />
        <Select
          lbl={t('deals.form.branch')}
          name={`${prefix}.branch`}
          ref={branchRef}
          options={opts(BRANCHES, dealBranchLabel)}
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
        <Select lbl={t('deals.form.prdct')} name={`${prefix}.prdct`} options={opts(prdct.prdctList, dealProductLabel)} required={false} defaultValue={curSale?.prdct} />
        {false && prdct.prdctTypeList?.length > 1 && prdct.branch !== 'אלמנטרי' ? (
          prdct.prdctTypeList.map((prdctType) => (
            <Input
              dir='ltr'
              required={false}
              key={prdctType}
              lbl={t('deals.form.amountOf', { type: dealProductTypeLabel(prdctType, t.locale) })}
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
                lbl={t('deals.form.saleType')}
                name={`${prefix}.prdctType`}
                options={opts(prdct.prdctTypeList, dealProductTypeLabel)}
                defaultValue={curSale?.prdctType}
              />
            </div>
            <Input lbl={t('deals.form.amount')} name={`${prefix}.amount`} type='number' defaultValue={curSale?.amount} />

            {/* bizNum / bizName hidden — insurance-era fields. */}
            <div className='hidden'>
              {prdct.branch === 'אלמנטרי' && (
                <>
                  <Input lbl={t('deals.form.bizNum')} name={`${prefix}.bizNum`} type='number' defaultValue={curSale?.bizNum} required={false} />
                  <Input lbl={t('deals.form.bizName')} name={`${prefix}.bizName`} defaultValue={curSale?.bizName} required={false} />
                </>
              )}
            </div>
          </>
        )}

        <Select lbl={t('deals.form.stage')} name={`${prefix}.status`} options={opts(STATUS_LIST, dealStatusLabel)} required defaultValue={normalizeStatus(curSale?.status)} />

        <Input required={false} lbl={t('deals.form.closeDate')} name={`${prefix}.saleDt`} type='date' defaultValue={curSale?.saleDt} />
        <span className='col-span-3 mobile:col-span-2'>
          <div className='accordion'>
            <AccordionItem title={t('deals.form.notes')}>
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
