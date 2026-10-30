'use client'
import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { getFormData2 } from '@/lib/form/funcs'
import { transferSales } from '../../actions/usersNteams'
import { api } from '@/lib/funcs'
import Title from '@/lib/Title'
import { SelectSearch } from '@/lib/form/SelectSearch'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'

const HEBREW = translatorFor('he')

/** `translated`: follow the interface language (settings → reps). Default Hebrew: the admin users table is not translated yet. */
export default function TransferSalesForm({ user, users, setCurUser = null, translated = false }) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const [pending, setPending] = useState<{ userId: number; name: string } | null>(null)

  function onSubmit(e) {
    e.preventDefault()
    const data = getFormData2(e)
    const targetUserId = Number(data.userId)
    const targetName = users.find((u) => u.id === targetUserId)?.name
    setPending({ userId: targetUserId, name: targetName })
  }

  async function onConfirm() {
    if (!pending) return
    api(transferSales, [user?.id, pending.userId])
    setPending(null)
    if (setCurUser) setCurUser(null)
  }

  return (
    <div id='transferSales' className='modal_pop' popover='auto'>
      <Title lbl={t('settings.account.transfer.title')} />
      <form onSubmit={onSubmit} className='py-4'>
        <SelectSearch className='w-64' name='userId' lbl={t('settings.account.transfer.pick')} options={users} />
        <Btn lbl={t('settings.account.transfer.submit')} className='mt-4 w-full' />
      </form>
      <ConfirmPop
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={onConfirm}
        msg={t('settings.account.transfer.confirm', { from: String(user?.name), to: String(pending?.name) })}
        translated={translated}
      />
    </div>
  )
}
