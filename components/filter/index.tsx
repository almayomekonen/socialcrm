'use client'

import { BRANCHES, COMPANIES, prdctOptByBranch, STATUS_LIST } from '@/types/lists'
import { Select } from '@/lib/form'
import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import SelectDateRange from './SelectDateRange'
import { usePathname, useRouter } from 'next/navigation'
import InputCheckbox from '../../lib/checkbox/InputCheckbox'
import Title from '../../lib/Title'
import { omitOffice } from '@/lib/funcs'
import { Route } from 'next'
import { MultiSelectSearch } from '@/lib/form/MultiSelectSearch'
import { getFormData2 } from '@/lib/form/funcs'
import { searchContacts } from '@/actions/clients'
import { useUser } from '@/lib/hooksNEvents'
import { clearPersistedFilter, filterSectionForPath } from '@/lib/filter/activeFilter'
import { useT } from '@/lib/i18n/I18nProvider'
import { dealActionLabel, dealBranchLabel, dealCompanyLabel, dealProductLabel, dealProductTypeLabel, dealStatusLabel, labelledOptions } from '@/lib/deals/labels'

type Props = {
  props: {
    users: any[]
    teams: any[]
    rawFilter: any
    handlers?: any[]
  }
}
export default function Filter({ props }: Props) {
  const t = useT()
  const pathname = usePathname()
  const show = getShow(pathname)
  const user = useUser()
  // Reset also forgets the remembered filter — of THIS section only.
  const section = filterSectionForPath(pathname)
  const onReset = () => section && user?.id && clearPersistedFilter(section, user.id)
  const router = useRouter()
  const { users, teams, handlers } = props || ({} as any)
  const rawFilter = (props?.rawFilter ?? {}) as any

  const filterPrdct = rawFilter?.branch ? prdctOptByBranch[rawFilter.branch] : ({} as any)
  const [prdct, setPrdct] = useState({
    prdctList: filterPrdct?.prdctList || [],
    prdctTypeList: filterPrdct?.prdctTypeList || [],
  })

  // Stored values stay the option values (the URL JSON is unchanged); only their text is labelled.
  const opts = (values: readonly string[] | undefined, label: Parameters<typeof labelledOptions>[1]) => labelledOptions(values ?? [], label, t.locale)

  function onSubmit(e) {
    const fd = getFormData2(e) as any
    console.log('filterdata', fd)
    document.getElementById('filterPop').hidePopover()
    router.replace(('?filter=' + JSON.stringify(fd)) as Route, { scroll: false })
  }

  return (
    <div popover='auto' className='modal_pop pb-0 pt-4 w-[660px] bg-white mobile:w-full mobile:p-3' id='filterPop'>
      <Title lbl={t('deals.filter.title')} icon='filter' className='mb-4' />
      <form onSubmit={onSubmit}>
        <div className='grid grid-cols-2 gap-4'>
          <SelectDateRange name='dateRange' lbl={t('deals.filter.offerDate')} start='start' end='end' filter={rawFilter} />
          <SelectDateRange name='saleDtRange' lbl={t('deals.filter.closeDate')} filter={rawFilter} start='saleDtStart' end='saleDtEnd' />
        </div>

        <section className='grid grid-cols-2 gap-4 mt-4 items-end'>
          {show.company && <MultiSelectSearch name='company' options={opts(COMPANIES, dealCompanyLabel)} lbl={t('deals.filter.company')} selected={rawFilter.company} />}
          {show.branchArea && (
            <>
              <Select
                name='branch'
                lbl={t('deals.filter.branch')}
                options={opts(BRANCHES, dealBranchLabel)}
                placeholder={t('deals.filter.all')}
                onChange={(e) => setPrdct(prdctOptByBranch[e.target.value])}
                required={false}
                defaultValue={rawFilter.branch}
              />
              <MultiSelectSearch
                key={['prdct', ...(prdct?.prdctList || [])].join('-')}
                name='prdct'
                options={opts(prdct?.prdctList, dealProductLabel)}
                lbl={t('deals.filter.product')}
                selected={rawFilter.prdct}
              />
              <MultiSelectSearch
                key={['prdctType', ...(prdct?.prdctTypeList || [])].join('-')}
                name='prdctType'
                options={opts(prdct?.prdctTypeList, dealProductTypeLabel)}
                lbl={t('deals.filter.productType')}
                selected={rawFilter.prdctType}
              />
            </>
          )}
          <MultiSelectSearch name='status' options={opts(STATUS_LIST, dealStatusLabel)} lbl={t('deals.filter.status')} selected={rawFilter.status} />

          {handlers && show.handlers && (
            <MultiSelectSearch
              name='handlerIds'
              options={handlers}
              lbl={t('deals.filter.handler')}
              returnShow='handlerNames'
              selected={rawFilter.handlerIds}
            />
          )}
          {show.clients && (
            <div className='col-span-2'>
              <MultiSelectSearch
                selected={rawFilter.clientIds}
                searchFunc={searchContacts}
                selectedShow={rawFilter.clientNames}
                name='clientIds'
                returnShow='clientNames'
                show='details'
                lbl={t('deals.filter.leads')}
              />
            </div>
          )}

          {Array.isArray(users) && users.length > 0 && show.users && (
            <div className='col-span-2'>
              <MultiSelectSearch
                name='userIds'
                options={omitOffice(users)}
                lbl={t('deals.filter.reps')}
                returnShow='userNames'
                selected={rawFilter.userIds}
              />
            </div>
          )}

          {Array.isArray(teams) && teams.length > 0 && show.teams && (
            <div className='col-span-2'>
              <MultiSelectSearch
                name='teamIds'
                options={teams}
                lbl={t('deals.filter.teams')}
                returnShow='teamNames'
                selected={rawFilter.teamIds}
              />
            </div>
          )}

          <div className='col-span-2 grid grid-cols-[1fr_auto_auto] gap-3 items-end'>
            <Select
              lbl={t('deals.filter.action')}
              name='action'
              options={opts(['מכירה', 'הצטרפות', 'הכל'], dealActionLabel)}
              defaultValue={rawFilter.action}
              required={false}
            />
            <InputCheckbox lbl={t('deals.filter.replaceOnly')} name='replace' defaultChecked={rawFilter.replace} />
            <InputCheckbox lbl={t('deals.filter.collabOnly')} name='isCollab' defaultChecked={rawFilter.isCollab} />
          </div>
        </section>

        <section className='sticky bottom-0 left-0 grid grid-cols-2 gap-4 bg-white py-4 mt-4'>
          <Btn variant='outline' lbl={t('deals.filter.reset')} type='button' href='?' icon='eraser' onClick={onReset} />
          <Btn lbl={t('deals.filter.apply')} icon='filter' />
        </section>
      </form>
    </div>
  )
}

function getShow(pathName) {
  // SocialCRM simplified filter — branch/product/company hidden from UI.
  // Existing conditionals in the form already respect these flags; logic kept intact.
  let res = {
    branchArea: false,
    handlers: true,
    clients: true,
    company: false,
    users: true,
    teams: true,
  }

  // if (pathName.includes('companies')) {
  //   res.company = false
  //   res.clients = false
  //   res.handlers = false
  //   res.branchArea = false
  // }
  // if (pathName.includes('months')) {
  //   res.clients = false
  //   res.handlers = false
  //   res.branchArea = false
  // }
  // if (pathName.includes('teams')) {
  //   res.clients = false
  //   res.handlers = false
  //   res.branchArea = false
  // }
  // if (pathName.includes('agents')) {
  //   res.clients = false
  //   res.handlers = false
  //   res.branchArea = false
  // }
  return res
}
