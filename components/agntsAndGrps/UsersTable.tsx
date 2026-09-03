'use client'

import { useState } from 'react'
import Search from '@/lib/table/Search'
import ShowColumns from '@/lib/table/ShowColumns'
import Table, { ConfigT } from '@/lib/table'
import { saveTblPref } from '@/actions/global'
import { MapRoles, rolesOpt } from '@/types/roles'
import TransferSalesForm from './TransferSalesForm'
import EditUser from './EditUser'
import { Select } from '@/lib/form'
import { Btn } from '@/lib/btns/Btn'
import ExportTable from '@/lib/table/export'

export default function UsersTable({ users, agnts, tblPref, teams }) {
  const tblId = 'usersTable194'
  const [state, setState] = useState(users)
  const [columns, setColumns] = useState(tblPref?.[tblId] || usersTableHeaders)

  const [curUser, setCurUser] = useState({})

  function moreRows(user) {
    return (
      <>
        <td className='sticky left-0 z-10 bg-white'>
          <Btn variant='outline' size='icon' icon='pen' aria-label='עריכת נציג' popoverTarget='editUserForm' onClick={() => setCurUser({ ...user })} />
        </td>
      </>
    )
  }

  function moreHeads() {
    return (
      <>
        <th className='sticky left-0 z-10 bg-gray-100'>עריכה</th>
      </>
    )
  }

  const config = {
    columns,
    setColumns,
    data: users,
    state,
    setState,
    moreHeads,
    moreRows,
    funcs: { formatArr, formatRole },
    noCheckboxs: true,
    getColumns(columns) {
      saveTblPref(tblId, columns)
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
              placeholder='כל התפקידים'
              options={rolesOpt}
              onChange={(e) => {
                const val = e.target.value
                val ? setState(users.filter((user) => user.role === val)) : setState(users)
              }}
            />
          </div>

          <div className='flex items-end mb-2'>
            <ExportTable data={state} columns={columns} />
            {/* <div className='flex gap-2'>
              <Btn lbl='משתמש חדש' popoverTarget='editUserForm' icon='user-plus' onClick={() => setCurUser(null)} />
            </div> */}
          </div>
        </div>

        <Table config={config} tblCls='mb-0 rounded-b-none' />

        <EditUser user={curUser} agnts={agnts} teams={teams} />
        <TransferSalesForm user={curUser} users={users} />
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
function formatRole(role) {
  return MapRoles[role]
}
