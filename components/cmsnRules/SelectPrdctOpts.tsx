import { BRANCHES, COMPANIES, prdctOptByBranch } from '@/types/lists'
import { useEffect, useState } from 'react'
import { Select } from '@/lib/form'
import { MultiSelectSearch } from '@/lib/form/MultiSelectSearch'

interface Props {
  index?: string
  prdct: any
  withCmsnBranch?: boolean
}

export default function SelectPrdctOpts({ prdct, index = '', withCmsnBranch = false }: Props) {
  const [selectedPrdct, setSelectedPrdct] = useState<any>(prdct)
  useEffect(() => {
    if (selectedPrdct?.branch) setSelectedPrdct(prdctOptByBranch[prdct.branch])
  }, [selectedPrdct?.branch])

  return (
    <>
      <Select
        options={withCmsnBranch ? ['משוקלל', ...BRANCHES] : BRANCHES}
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
