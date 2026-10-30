'use client'

import Title from '@/lib/Title'
import { Roles } from '@/types/roles'
import { deleteUser, fetchIsUserHaveSales, upsertUser, upsertUserNPerms } from '../../actions/usersNteams'
import { useEffect, useState } from 'react'
import { api } from '@/lib/funcs'
import InputCheckbox from '@/lib/checkbox/InputCheckbox'
import { MultiSelectSearch } from '@/lib/form/MultiSelectSearch'
import { getFormData2 } from '@/lib/form/funcs'
import { Input, Select } from '@/lib/form'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'
import { adminRoleOptions } from './adminLabels'

export default function EditUser({ user, agnts, teams }) {
  const t = useT()
  const [role, setRole] = useState<Roles>(user?.role)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  useEffect(() => {
    setRole(user?.role)
  }, [user?.role])

  async function onSubmit(e) {
    const fd = getFormData2(e) as any

    // IF FORM DATA ROLE IS OFFICE
    if (fd.role === Roles.OFFICE) {
      if (user?.id && user.role !== Roles.OFFICE) {
        const userHaveSales = await fetchIsUserHaveSales(user.id)
        if (userHaveSales) {
          return setErrMsg(t('admin.users.edit.officeRefused'))
        }
      }

      api(upsertUserNPerms, [fd, user?.id])
      return
    }

    // IF FORM DATA ROLE ISN'T OFFICE
    if (user?.role === Roles.OFFICE && fd.role !== Roles.OFFICE) fd.gotPermIds = []

    fd.suspended = Boolean(fd.suspended)

    delete fd.gotPermIds
    api(upsertUser, [fd, user?.id])
  }

  function onDelete() {
    setConfirmDelete(true)
  }

  async function performDelete() {
    setConfirmDelete(false)
    const userHaveSales = await fetchIsUserHaveSales(user?.id)
    if (userHaveSales) {
      return setErrMsg(t('admin.users.edit.deleteRefused', { name: String(user.name) }))
    }

    await api(deleteUser, user?.id, null, t('admin.users.edit.deleteLinked'))
  }

  return (
    <div popover='auto' id='editUserForm' className='modal_pop'>
      <div className='flex justify-between'>
        <Title lbl={`${user?.name || t('admin.users.edit.newUser')}`} icon='user' />
        <div className='flex gap-2 flex-nowrap'>
          {user?.id && role !== 'OFFICE' && (
            <Btn variant='outline' size='icon' title={t('admin.users.edit.transfer')} icon='right-left' popoverTarget='transferSales' />
          )}
          {user?.id && <Btn variant='outline' size='icon' icon='trash' aria-label={t('admin.users.edit.deleteRep')} onClick={onDelete} />}
        </div>
      </div>
      <form key={user?.id} onSubmit={onSubmit} className='max-w-xl'>
        <h2 className='my-4 text-lg border-b text-gray-600 w-full'>{t('admin.users.edit.personal')}</h2>
        <div className='grid grid-cols-3 gap-4 items-end mobile:grid-cols-2 mobile:gap-2'>
          <Input lbl={t('admin.users.edit.firstName')} name='firstName' defaultValue={user?.firstName} />
          <Input lbl={t('admin.users.edit.lastName')} name='lastName' defaultValue={user?.lastName} />
          <Input
            lbl={t('admin.users.edit.email')}
            name='email'
            defaultValue={user?.email}
            type='email'
            title={t('admin.users.edit.emailTitle')}
          />

          <Input lbl={t('admin.users.edit.phone')} name='phone' required={false} defaultValue={user?.phone} />
          <Select
            lbl={t('admin.users.edit.role')}
            name='role'
            options={adminRoleOptions(t.locale)}
            defaultValue={user?.role}
            onChange={(e) => setRole(e.target.value as Roles)}
          />
          {role !== Roles.EXT && <InputCheckbox lbl={t('admin.users.edit.suspended')} name='suspended' defaultChecked={user?.suspended} />}
        </div>

        {role == 'OFFICE' && (
          <div className='my-4 space-y-4'>
            <h2 className='text-lg border-b text-gray-600 w-full'>{t('admin.users.edit.perms')}</h2>
            <MultiSelectSearch options={agnts} selected={user?.gotPerm.map((item) => item.id)} name='gotPermIds' lbl={t('admin.users.edit.reps')} />
          </div>
        )}

        <Btn lbl={t('admin.users.edit.save')} icon='floppy-disk' className='w-full my-8' />
      </form>
      <ConfirmPop
        open={confirmDelete}
        destructive
        onClose={() => setConfirmDelete(false)}
        onConfirm={performDelete}
        msg={t('admin.users.edit.deleteConfirm', { name: String(user?.name) })}
        translated
      />
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