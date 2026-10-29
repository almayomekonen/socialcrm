'use client'
import { useState } from 'react'
import { getFormData2 } from '@/lib/form/funcs'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import { api } from '@/lib/funcs'
import { upsertExtUser } from '@/actions/usersNteams'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'

export default function ExtUserForm({ user, setCurUser }) {
  const t = useT()
  const [errMsg, setErrMsg] = useState<string | null>(null)

  async function onSave(e) {
    const data = getFormData2(e)

    const res = await api(upsertExtUser, [data, user?.id])
    if (res.err && res.msg.includes('duplicate')) return setErrMsg(t('settings.account.ext.duplicate'))

    e.target.reset()
    setCurUser(null)
  }

  return (
    <>
      <form className='max-w-72 ' key={user?.id} onSubmit={onSave}>
        <Input lbl={t('settings.account.ext.firstName')} name='firstName' defaultValue={user?.firstName} className=' mb-1' />
        <Input lbl={t('settings.account.ext.lastName')} name='lastName' defaultValue={user?.lastName} required={false} />
        <div className='grid grid-cols-2 mt-4 gap-4'>
          {user && <Btn variant='outline' lbl={t('settings.account.ext.cancel')} icon='xmark' onClick={() => setCurUser(null)} />}
          <Btn
            lbl={user?.id ? t('settings.account.ext.saveEdit') : t('settings.account.ext.add')}
            icon={user?.id ? 'floppy-disk-pen' : 'floppy-disk'}
            className={user?.id ? '' : 'col-span-2'}
          />
        </div>
      </form>
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
        translated
      />
    </>
  )
}
