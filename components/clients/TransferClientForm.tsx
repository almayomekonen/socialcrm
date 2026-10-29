import { Btn } from '@/lib/btns/Btn'
import Title from '@/lib/Title'
import { getFormData2 } from '@/lib/form/funcs'
import { api } from '@/lib/funcs'
import { useState } from 'react'
import { transferLeadToRep } from '@/actions/clients'
import { useProps } from '@/lib/hooksNEvents'
import { SelectSearch } from '@/lib/form/SelectSearch'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'

export default function TransferClientForm({ client }) {
  const t = useT()
  let { users } = useProps()
  const [userName, setUserName] = useState('')
  const [pending, setPending] = useState<{ userId: any } | null>(null)

  function onSubmit(e) {
    e.preventDefault()
    const data = getFormData2(e)
    setPending({ userId: data.userId })
  }

  async function onConfirm() {
    if (!pending) return
    await api(transferLeadToRep, [client.id, pending.userId])
    setPending(null)
  }

  return (
    <div>
      <Title lbl={t('leads.transfer.title', { owner: `${client.userName}` })} className='mb-6' />
      <form id='transferClientForm' onSubmit={onSubmit}>
        <SelectSearch name='userId' lbl={t('leads.transfer.pickOwner')} options={users} onSelectOpt={(user) => setUserName(user.name)} />
        <Btn lbl={t('common.save')} className='w-full mt-8' icon='floppy-disk' />
      </form>
      <ConfirmPop
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={onConfirm}
        msg={t('leads.transfer.confirm', { name: `${client.name}`, owner: userName })}
        translated
      />
    </div>
  )
}
