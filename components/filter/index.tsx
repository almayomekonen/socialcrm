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

type Props = {
  props: {
    users: any[]
    teams: any[]
    rawFilter: any
    handlers?: any[]
  }
}
export default function Filter({ props }: Props) {
  const show = getShow(usePathname())
  const router = useRouter()
  const { users, teams, rawFilter, handlers } = props

  const filterPrdct = rawFilter?.branch ? prdctOptByBranch[rawFilter.branch] : ({} as any)
  const [prdct, setPrdct] = useState({
    prdctList: filterPrdct?.prdctList || [],
    prdctTypeList: filterPrdct?.prdctTypeList || [],
  })

  function onSubmit(e) {
    const fd = getFormData2(e) as any
    console.log('filterdata', fd)
    document.getElementById('filterPop').hidePopover()
    router.replace(('?filter=' + JSON.stringify(fd)) as Route, { scroll: false })
  }

  return (
    <div popover='auto' className='modal_pop pb-0 pt-4 w-[660px] bg-white mobile:w-full mobile:p-3' id='filterPop'>
      <Title lbl='סינונים' icon='filter' className='mb-4' />
      <form onSubmit={onSubmit}>
        <div className='grid grid-cols-2 gap-4'>
          <SelectDateRange name='dateRange' lbl='תאריך פנייה:' start='start' end='end' filter={rawFilter} />
          <SelectDateRange name='saleDtRange' lbl='תאריך סגירה:' filter={rawFilter} start='saleDtStart' end='saleDtEnd' />
        </div>

        <section className='grid grid-cols-2 gap-4 mt-4 items-end'>
          {show.company && <MultiSelectSearch name='company' options={COMPANIES} lbl='חברה' selected={rawFilter.company} />}
          {show.branchArea && (
            <>
              <Select
                name='branch'
                lbl='ענף:'
                options={BRANCHES}
                placeholder='הכל'
                onChange={(e) => setPrdct(prdctOptByBranch[e.target.value])}
                required={false}
                defaultValue={rawFilter.branch}
              />
              <MultiSelectSearch
                key={['prdct', ...(prdct?.prdctList || [])].join('-')}
                name='prdct'
                options={prdct?.prdctList}
                lbl='מוצר'
                selected={rawFilter.prdct}
              />
              <MultiSelectSearch
                key={['prdctType', ...(prdct?.prdctTypeList || [])].join('-')}
                name='prdctType'
                options={prdct?.prdctTypeList}
                lbl='סוג המוצר'
                selected={rawFilter.prdctType}
              />
            </>
          )}
          <MultiSelectSearch name='status' options={STATUS_LIST} lbl='סטטוס' selected={rawFilter.status} />

          {handlers && show.handlers && (
            <MultiSelectSearch
              name='handlerIds'
              options={handlers}
              lbl='אחראי'
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
                lbl='לידים'
              />
            </div>
          )}

          {users?.length > 0 && show.users && (
            <div className='col-span-2'>
              <MultiSelectSearch
                name='userIds'
                options={omitOffice(users)}
                lbl='נציגים'
                returnShow='userNames'
                selected={rawFilter.userIds}
              />
            </div>
          )}

          {teams?.length > 0 && show.teams && (
            <div className='col-span-2'>
              <MultiSelectSearch
                name='teamIds'
                options={teams}
                lbl='צוותים'
                returnShow='teamNames'
                selected={rawFilter.teamIds}
              />
            </div>
          )}

          <div className='col-span-2 grid grid-cols-[1fr_auto_auto] gap-3 items-end'>
            <Select
              lbl='פעולה'
              name='action'
              options={['מכירה', 'הצטרפות', 'הכל']}
              defaultValue={rawFilter.action}
              required={false}
            />
            <InputCheckbox lbl='החלפה בלבד' name='replace' defaultChecked={rawFilter.replace} />
            <InputCheckbox lbl='שת"פ בלבד' name='isCollab' defaultChecked={rawFilter.isCollab} />
          </div>
        </section>

        <section className='sticky bottom-0 left-0 grid grid-cols-2 gap-4 bg-white py-4 mt-4'>
          <Btn variant='outline' lbl='איפוס סינונים' type='button' href='?' icon='eraser' />
          <Btn lbl='סינון' icon='filter' />
        </section>
      </form>
    </div>
  )
}

function getShow(pathName) {
  let res = {
    branchArea: true,
    handlers: true,
    clients: true,
    company: true,
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
