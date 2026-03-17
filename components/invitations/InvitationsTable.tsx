'use client'
import { useState } from 'react'
import Search from '@/lib/table/Search'
import ShowColumns from '@/lib/table/ShowColumns'
import Table, { ConfigT } from '@/lib/table'
import { saveTblPref } from '@/actions/global'
import { Btn } from '@/lib/btns/Btn'
import { MapRoles, Roles, rolesOpt } from '@/types/roles'
import { Input, Select } from '@/lib/form'
import Title from '../../lib/Title'
import { deleteInvitation, sendInvitation } from '@/actions/invitations'
import { api } from '@/lib/funcs'
import { isUserExists } from '@/actions/auth'
import { getFormData2 } from '@/lib/form/funcs'

export default function InvitationsTable({ data, tblPref }) {
  const tblId = 'invitationsTable194'
  const [state, setState] = useState(data)
  const [columns, setColumns] = useState(tblPref?.[tblId] || usersTableHeaders)

  function moreRows(invitation) {
    async function onDelete() {
      if (!confirm('האם למחוק את ההזמנה?')) return
      await api(deleteInvitation, [invitation.id])
    }
    return (
      <>
        <td className='sticky left-0 z-10 bg-white'>
          <Btn variant='outline' size='icon' icon='trash' onClick={() => onDelete()} />
        </td>
      </>
    )
  }

  function moreHeads() {
    return (
      <>
        <th className='sticky left-0 z-10 bg-gray-100'>מחיקה</th>
      </>
    )
  }

  const config = {
    columns,
    setColumns,
    data,
    state,
    setState,
    moreHeads,
    moreRows,
    funcs: { formatRole, formatStatus },
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
                val ? setState(data.filter((user) => user.role === val)) : setState(data)
              }}
            />
          </div>

          <div className='flex items-end mb-2'>
            <Btn popoverTarget='invitationsForm' lbl='הזמנת משתמש' />
            <InvitationsForm />
          </div>
        </div>

        <Table config={config} tblCls='mb-0 rounded-b-none' />
      </div>
    </>
  )
}

export const usersTableHeaders = [
  { key: 'firstName', label: 'שם פרטי' },
  { key: 'lastName', label: 'שם משפחה' },
  { key: 'email', label: 'אימייל' },
  { key: 'role', label: 'תפקיד', format: 'formatRole' },
  { key: 'phone', label: 'טלפון' },
  { key: 'createdAt', label: 'נוצר בתאריך', format: 'formatDate' },
  { key: 'expiresAt', label: 'תאריך תפוגה', format: 'formatDate' },
  { key: 'status', label: 'סטטוס', format: 'formatStatus' },
]

function formatRole(role) {
  return MapRoles[role]
}
function formatStatus(_, obj) {
  return <p>{new Date(obj.expiresAt) < new Date() ? 'פג תוקף' : 'ממתין לאישור'}</p>
}

function InvitationsForm() {
  async function handleSubmit(e) {
    const data = getFormData2(e)
    console.log('data:', data)
    const res = (await isUserExists(data.email)) as any
    if (res.id) return alert('המשתמש כבר קיים')
    await api(sendInvitation, [data])
  }
  return (
    <div popover='auto' id='invitationsForm' className='pop'>
      <Title lbl='משתמש חדש' />
      <form className=' grid grid-cols-2 gap-4 mt-4' onSubmit={handleSubmit}>
        <Input name='firstName' lbl='שם פרטי' />
        <Input name='lastName' lbl='שם משפחה' />
        <Input name='email' lbl='אימייל' />
        <Input name='phone' lbl='טלפון' required={false} />
        <Select lbl='תפקיד' name='role' options={rolesOpt} defaultValue={Roles.AGNT} />
        <Btn lbl='שליחת הזמנה' className='col-span-2' />
      </form>
    </div>
  )
}
