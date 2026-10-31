'use client'
import { useState } from 'react'
import Search from '@/lib/table/Search'
import ShowColumns from '@/lib/table/ShowColumns'
import Table, { ConfigT } from '@/lib/table'
import { saveTblPref } from '@/actions/global'
import { Btn } from '@/lib/btns/Btn'
import { Roles } from '@/types/roles'
import { Input, Select } from '@/lib/form'
import Title from '../../lib/Title'
import { deleteInvitation, sendInvitation } from '@/actions/invitations'
import { api } from '@/lib/funcs'
import { toast } from '@/lib/toast'
import { isUserExists } from '@/actions/auth'
import { getFormData2 } from '@/lib/form/funcs'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'
import { actionsColumnEdge } from '@/lib/table/funcs'
import type { Translator } from '@/lib/i18n/translate'
import { useLocalizedColumns } from '@/components/clients/table/useLocalizedColumns'
import { formatLeadDate } from '@/lib/leads/leadDate'
import { adminRoleLabel, adminRoleOptions, invitationColumnLabel, invitationErrorText } from '@/components/agntsAndGrps/adminLabels'

export default function InvitationsTable({ data, tblPref }) {
  const tblId = 'invitationsTable194'
  const [state, setState] = useState(data)
  const t = useT()
  const locale = t.locale
  const [storedColumns, setStoredColumns] = useState(tblPref?.[tblId] || usersTableHeaders)
  // Headers by column KEY in the interface language; the stored columns (and what is saved) keep their Hebrew labels.
  const localized = useLocalizedColumns(storedColumns, setStoredColumns, (next) => saveTblPref(tblId, next), invitationColumnLabel)
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
        <td className={`sticky ${actionsColumnEdge(t.locale)} z-10 bg-white`}>
          <Btn variant='outline' size='icon' icon='trash' aria-label={t('admin.invitations.deleteLabel')} onClick={() => setInvitationToDelete(invitation)} />
        </td>
      </>
    )
  }

  function moreHeads() {
    return (
      <>
        <th className={`sticky ${actionsColumnEdge(t.locale)} z-10 bg-gray-100`}>{t('admin.invitations.col.delete')}</th>
      </>
    )
  }

  const config = {
    columns: localized.columns,
    setColumns: localized.setColumns,
    data,
    state,
    setState,
    moreHeads,
    moreRows,
    funcs: {
      formatRole: (role) => adminRoleLabel(role, locale),
      formatStatus: (value, obj) => formatStatus(value, obj, t),
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
                val ? setState(data.filter((user) => user.role === val)) : setState(data)
              }}
            />
          </div>

          <div className='flex items-end mb-2'>
            <Btn popoverTarget='invitationsForm' lbl={t('admin.invitations.invite')} />
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
        msg={t('admin.invitations.deleteConfirm')}
        translated
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

function formatStatus(_, obj, t: Translator) {
  return <p>{new Date(obj.expiresAt) < new Date() ? t('admin.invitations.expired') : t('admin.invitations.pending')}</p>
}

function InvitationsForm() {
  const t = useT()
  const GENERIC_ERROR = t('admin.invitations.genericError')
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
    if (existing?.id) return setErrMsg(t('admin.invitations.existing'))

    /**
     * `silentSuccess` matters here. `api()` toasts success for anything that does
     * not THROW, and `sendInvitation` reports its expected failures by RETURNING
     * `{ error }` — permission, invalid role, send failure. The result was also
     * discarded, so a failed invitation announced itself as sent and the admin
     * had no way to know. Feedback is decided here instead, from the value.
     */
    const res = await api(sendInvitation, [data], undefined, undefined, { silentSuccess: true })
    if (res?.err) return setErrMsg(res.msg || GENERIC_ERROR)
    if (res?.error) return setErrMsg(invitationErrorText(res.error, t.locale))

    toast('success')
    form.reset()
  }
  return (
    <div popover='auto' id='invitationsForm' className='pop'>
      <Title lbl={t('admin.invitations.form.title')} />
      <form className=' grid grid-cols-2 gap-4 mt-4' onSubmit={handleSubmit}>
        <Input name='firstName' lbl={t('admin.invitations.form.firstName')} />
        <Input name='lastName' lbl={t('admin.invitations.form.lastName')} />
        <Input name='email' lbl={t('admin.invitations.form.email')} />
        <Input name='phone' lbl={t('admin.invitations.form.phone')} required={false} />
        <Select lbl={t('admin.invitations.form.role')} name='role' options={adminRoleOptions(t.locale)} defaultValue={Roles.AGNT} />
        <Btn lbl={t('admin.invitations.form.send')} className='col-span-2' />
      </form>
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
        translated
      />
    </div>
  )
}
