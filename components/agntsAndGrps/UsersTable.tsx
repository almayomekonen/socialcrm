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
import { ToolTip } from '@/lib/Tooltip'

export default function UsersTable({ users, agnts, tblPref, teams }) {
  const tblId = 'usersTable194'
  const [state, setState] = useState(users)
  const [columns, setColumns] = useState(tblPref?.[tblId] || usersTableHeaders)

  const [curUser, setCurUser] = useState({})
  console.log('curUser', curUser)

  function moreRows(user) {
    return (
      <>
        <td className='sticky left-0 z-10 bg-white'>
          <Btn variant='outline' size='icon' icon='pen' popoverTarget='editUserForm' onClick={() => setCurUser({ ...user })} />
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
    funcs: { formatArr, formatRole, formatGoals },
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
  // { key: 'goals', label: 'יעדים', format: 'formatGoals' },
  { key: 'goals.משוקלל', label: 'יעד עמלה', format: 'formatCurrency' },
  { key: 'goals.סיכונים', label: 'יעד שירותים', format: 'formatCurrency' },
  { key: 'goals.פנסיוני-שוטף', label: 'יעד מנויים-שוטף', format: 'formatCurrency' },
  { key: 'goals.פיננסים', label: 'יעד חבילות', format: 'formatCurrency' },
  { key: 'goals.פנסיוני-ניוד', label: 'יעד מנויים-ניוד', format: 'formatCurrency' },
  { key: 'goals.פיננסים-שוטף', label: 'יעד חבילות-שוטף', format: 'formatCurrency' },
  { key: 'goals.אלמנטרי', label: 'יעד מוצרים', format: 'formatCurrency' },
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
function formatGoals(_, obj) {
  let goals = obj.goals
  if (!goals) return ''

  const gls = Object.keys(goals).filter((key) => goals[key] !== null && goals[key] !== 0)
  const res = gls.map((key) => `${key}: ${goals[key]}`).join(', ')

  return (
    <div>
      <ToolTip lbl={gls.length > 0 ? res : ''}>({`${gls.length}`})</ToolTip>
    </div>
  )
}

function formatRole(role) {
  return MapRoles[role]
}
