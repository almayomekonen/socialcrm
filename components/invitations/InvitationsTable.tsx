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
import { toast } from '@/lib/toast'
import { isUserExists } from '@/actions/auth'
import { getFormData2 } from '@/lib/form/funcs'
import ConfirmPop from '@/lib/modals/ConfirmPop'

export default function InvitationsTable({ data, tblPref }) {
  const tblId = 'invitationsTable194'
  const [state, setState] = useState(data)
  const [columns, setColumns] = useState(tblPref?.[tblId] || usersTableHeaders)
  const [invitationToDelete, setInvitationToDelete] = useState<any>(null)

  async function performInvitationDelete() {
    if (!invitationToDelete) return
    const id = invitationToDelete.id
    setInvitationToDelete(null)
    await api(deleteInvitation, [id])
  }

  function moreRows(invitation) {
    return (
      <>
        <td className='sticky left-0 z-10 bg-white'>
          <Btn variant='outline' size='icon' icon='trash' aria-label='מחיקת הזמנה' onClick={() => setInvitationToDelete(invitation)} />
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

      <ConfirmPop
        open={!!invitationToDelete}
        destructive
        onClose={() => setInvitationToDelete(null)}
        onConfirm={performInvitationDelete}
        msg='האם למחוק את ההזמנה?'
      />
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

const GENERIC_ERROR = 'אירעה שגיאה, נסה שוב'
const EXISTING_USER_MESSAGE =
  'המשתמש כבר קיים במערכת, ולכן אין צורך בהזמנה. כדי שיהיה נציג — אפשר לשנות את התפקיד שלו בטבלת המשתמשים שמעל.'

function InvitationsForm() {
  const [errMsg, setErrMsg] = useState<string | null>(null)

  async function handleSubmit(e) {
    const data = getFormData2(e)
    // Captured before the awaits: the handler resets it on success, and the
    // event object should not be relied on after an await.
    const form = e.target as HTMLFormElement

    /**
     * Wrapped, where it used to be a bare call. A rejected server action here
     * terminated the handler with no toast, no dialog and nothing rendered — the
     * submit simply did nothing.
     */
    const existing = await api(isUserExists, [data.email], undefined, undefined, { silentSuccess: true })
    if (existing?.err) return setErrMsg(existing.msg || GENERIC_ERROR)
    /**
     * The guard stays — but it is no longer a dead end.
     *
     * An invitation for an existing address is guaranteed to fail when it is
     * redeemed: app/api/invitation/route.ts refuses an email that already has a
     * user, and `Agnt_email_key` makes a duplicate impossible anyway. So issuing
     * one would only produce a row that can never be accepted.
     *
     * "Already a user" must not mean "cannot be a נציג", and it does not: an
     * ADMIN can set that person's role on this very page, in the users table
     * above, through the role field EditUser already exposes. That is the path
     * this message now names, instead of stopping at the fact.
     *
     * A second, EXT-style record for the same person is NOT the answer here:
     * `users_firstName_lastName_agencyId_unique` forbids a same-name twin inside
     * one agency.
     */
    if (existing?.id) return setErrMsg(EXISTING_USER_MESSAGE)

    /**
     * `silentSuccess` matters here. `api()` toasts success for anything that does
     * not THROW, and `sendInvitation` reports its expected failures by RETURNING
     * `{ error }` — permission, invalid role, send failure. The result was also
     * discarded, so a failed invitation announced itself as sent and the admin
     * had no way to know. Feedback is decided here instead, from the value.
     */
    const res = await api(sendInvitation, [data], undefined, undefined, { silentSuccess: true })
    if (res?.err) return setErrMsg(res.msg || GENERIC_ERROR)
    if (res?.error) return setErrMsg(res.error)

    toast('success')
    form.reset()
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
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
      />
    </div>
  )
}
