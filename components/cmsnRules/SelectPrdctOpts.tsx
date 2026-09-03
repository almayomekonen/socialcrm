import { BRANCHES, COMPANIES, prdctOptByBranch } from '@/types/lists'
import { useEffect, useState } from 'react'
import { Select } from '@/lib/form'
import { MultiSelectSearch } from '@/lib/form/MultiSelectSearch'

interface Props {
  index?: string
  prdct: any
}

export default function SelectPrdctOpts({ prdct, index = '' }: Props) {
  const [selectedPrdct, setSelectedPrdct] = useState<any>(prdct)
  useEffect(() => {
    if (selectedPrdct?.branch) setSelectedPrdct(prdctOptByBranch[prdct.branch])
  }, [selectedPrdct?.branch])

  /**
   * Only the generic branches are offered — `משוקלל` (a weighted insurance
   * premium) used to be prepended here for the promotions form and was the last
   * insurance term an administrator could still select in Settings.
   *
   * A value already stored on a record is kept in the list rather than dropped.
   * `Select` renders `defaultValue` through its options, so removing the option
   * outright would blank the field on an existing promotion and clear its branch
   * the next time someone saved it. Legacy records stay readable and round-trip
   * unchanged; only NEW selections are limited to BRANCHES.
   */
  const branchOptions =
    prdct?.branch && !BRANCHES.includes(prdct.branch) ? [prdct.branch, ...BRANCHES] : BRANCHES

  return (
    <>
      <Select
        options={branchOptions}
        placeholder='בחר ענף'
        lbl='ענף'
        onChange={(e) => setSelectedPrdct(prdctOptByBranch[e.target.value])}
        name={`branch${index}`}
        defaultValue={prdct?.branch || ''}
        className='w-32'
      />

      <MultiSelectSearch
        key={['prdct', ...(selectedPrdct?.prdctList || [])].join('-')}
        lbl='מוצר'
        placeholder='בחר מוצרים'
        name={`prdcts${index}`}
        options={selectedPrdct?.prdctList || []}
        selected={prdct?.prdcts}
      />

      <MultiSelectSearch
        key={['prdctType', ...(selectedPrdct?.prdctTypeList || [])].join('-')}
        lbl='סוג מוצר'
        placeholder='בחר סוג מוצרים'
        name={`prdctTypes${index}`}
        options={selectedPrdct?.prdctTypeList || []}
        selected={prdct?.prdctTypes}
      />

      <MultiSelectSearch
        lbl='חברה'
        placeholder='בחר חברות'
        name={`companies${index}`}
        options={COMPANIES}
        selected={prdct?.companies}
      />
    </>
  )
}
