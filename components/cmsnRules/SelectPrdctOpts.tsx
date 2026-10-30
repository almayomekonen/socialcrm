import { BRANCHES, COMPANIES, prdctOptByBranch } from '@/types/lists'
import { useEffect, useState } from 'react'
import { Select } from '@/lib/form'
import { MultiSelectSearch } from '@/lib/form/MultiSelectSearch'
import { useT } from '@/lib/i18n/I18nProvider'
import type { UiLocale } from '@/lib/i18n/config'
import { dealBranchLabel, dealCompanyLabel, dealProductLabel, dealProductTypeLabel, labelledOptions } from '@/lib/deals/labels'

/**
 * Stored Hebrew values stay the option VALUES (what the form submits); outside
 * Hebrew only the shown name is labelled. Hebrew passes the stored lists
 * themselves, exactly as before. Only the campaign editor renders this picker.
 */
function shown(values: string[], label: (v: unknown, l?: UiLocale) => string, locale: UiLocale) {
  return locale === 'he' ? values : labelledOptions(values, label, locale)
}

interface Props {
  index?: string
  prdct: any
}

export default function SelectPrdctOpts({ prdct, index = '' }: Props) {
  const t = useT()
  const locale = t.locale
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
        options={shown(branchOptions, dealBranchLabel, locale)}
        placeholder={t('admin.promos.product.pickBranch')}
        lbl={t('admin.promos.product.branch')}
        onChange={(e) => setSelectedPrdct(prdctOptByBranch[e.target.value])}
        name={`branch${index}`}
        defaultValue={prdct?.branch || ''}
        className='w-32'
      />

      <MultiSelectSearch
        key={['prdct', ...(selectedPrdct?.prdctList || [])].join('-')}
        lbl={t('admin.promos.product.product')}
        placeholder={t('admin.promos.product.pickProducts')}
        name={`prdcts${index}`}
        options={shown(selectedPrdct?.prdctList || [], dealProductLabel, locale)}
        selected={prdct?.prdcts}
      />

      <MultiSelectSearch
        key={['prdctType', ...(selectedPrdct?.prdctTypeList || [])].join('-')}
        lbl={t('admin.promos.product.productType')}
        placeholder={t('admin.promos.product.pickTypes')}
        name={`prdctTypes${index}`}
        options={shown(selectedPrdct?.prdctTypeList || [], dealProductTypeLabel, locale)}
        selected={prdct?.prdctTypes}
      />

      <MultiSelectSearch
        lbl={t('admin.promos.product.company')}
        placeholder={t('admin.promos.product.pickCompanies')}
        name={`companies${index}`}
        options={shown(COMPANIES, dealCompanyLabel, locale)}
        selected={prdct?.companies}
      />
    </>
  )
}
