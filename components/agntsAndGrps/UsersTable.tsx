'use client'

import { useState } from 'react'
import Search from '@/lib/table/Search'
import ShowColumns from '@/lib/table/ShowColumns'
import Table, { ConfigT } from '@/lib/table'
import { saveTblPref } from '@/actions/global'
import TransferSalesForm from './TransferSalesForm'
import EditUser from './EditUser'
import { Select } from '@/lib/form'
import { Btn } from '@/lib/btns/Btn'
import ExportTable from '@/lib/table/export'
import { useT } from '@/lib/i18n/I18nProvider'
import { actionsColumnEdge } from '@/lib/table/funcs'
import { useLocalizedColumns } from '@/components/clients/table/useLocalizedColumns'
import { formatLeadDate } from '@/lib/leads/leadDate'
import { adminRoleLabel, adminRoleOptions, userColumnLabel } from './adminLabels'

export default function UsersTable({ users, agnts, tblPref, teams }) {
  const tblId = 'usersTable194'
  const [state, setState] = useState(users)
  const t = useT()
  const locale = t.locale
  const [storedColumns, setStoredColumns] = useState(tblPref?.[tblId] || usersTableHeaders)
  // Headers by column KEY in the interface language; the stored columns (and what is saved) keep their Hebrew labels.
  const localized = useLocalizedColumns(storedColumns, setStoredColumns, (next) => saveTblPref(tblId, next), userColumnLabel)

  const [curUser, setCurUser] = useState({})

  function moreRows(user) {
    return (
      <>
        <td className={`sticky ${actionsColumnEdge(t.locale)} z-10 bg-white`}>
          <Btn variant='outline' size='icon' icon='pen' aria-label={t('admin.users.editRep')} popoverTarget='editUserForm' onClick={() => setCurUser({ ...user })} />
        </td>
      </>
    )
  }

  function moreHeads() {
    return (
      <>
        <th className={`sticky ${actionsColumnEdge(t.locale)} z-10 bg-gray-100`}>{t('admin.users.col.edit')}</th>
      </>
    )
  }

  const config = {
    columns: localized.columns,
    setColumns: localized.setColumns,
    data: users,
    state,
    setState,
    moreHeads,
    moreRows,
    funcs: {
      formatArr,
      formatRole: (role) => adminRoleLabel(role, locale),
      // Outside Hebrew dates use the business time zone; Hebrew keeps the table's own formatter.
      ...(locale === 'he' ? {} : { formatDate: (value) => (value ? formatLeadDate(locale, value) : '') }),
    },
    noCheckboxs: true,
    getColumns(columns) {
      localized.save(columns as unknown as Parameters<typeof localized.save>[0])
    },
  } as ConfigT

  return (
    <>
      <div className='grid'>
        <div className='flex justify-between gap-2'>
          <div className='flex gap-4 items-end mb-2 mobile:gap-2'>
            <Search config={config} />
            <ShowColumns config={config} />
            <Select
              placeholder={t('admin.users.allRoles')}
              options={adminRoleOptions(locale)}
              onChange={(e) => {
                const val = e.target.value
                val ? setState(users.filter((user) => user.role === val)) : setState(users)
              }}
            />
          </div>

          <div className='flex items-end mb-2'>
            <ExportTable data={state} columns={storedColumns} />
            {/* <div className='flex gap-2'>
              <Btn lbl='משתמש חדש' popoverTarget='editUserForm' icon='user-plus' onClick={() => setCurUser(null)} />
            </div> */}
          </div>
        </div>

        <Table config={config} tblCls='mb-0 rounded-b-none' />

        <EditUser user={curUser} agnts={agnts} teams={teams} />
        <TransferSalesForm user={curUser} users={users} translated />
      </div>
    </>
  )
}

export const usersTableHeaders = [
  { key: 'name', label: 'שם' },
  { key: 'role', label: 'תפקיד', format: 'formatRole' },
  { key: 'email', label: 'אימייל' },
  { key: 'phone', label: 'טלפון' },
  { key: 'suspended', label: 'מושעה' },
  { key: 'gavePerm', label: 'הרשאות שנתן', format: 'formatArr' },
  { key: 'gotPerm', label: 'הרשאות שקיבל', format: 'formatArr' },
  { key: 'updatedAt', label: 'עודכן בתאריך', format: 'formatDate' },
  { key: 'createdAt', label: 'נוצר בתאריך', format: 'formatDate' },
  { key: 'id', label: 'מזהה' },
]

function formatArr(arr) {
  if (!arr) return ''
  return arr.map((item) => item.name).join(', ')
}
