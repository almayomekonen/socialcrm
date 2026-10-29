'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import Title from '@/lib/Title'
import { getFormData2 } from '@/lib/form/funcs'
import { SelectSearch } from '@/lib/form/SelectSearch'
import { useProps } from '@/lib/hooksNEvents'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * Pick the representative a set of selected leads is assigned to.
 *
 * The bulk counterpart of `TransferClientForm`, built from the same two
 * primitives it uses — `SelectSearch` over `useProps().users` and `ConfirmPop` —
 * so the single-lead and many-lead flows look and behave alike.
 *
 * The confirmation names the COUNT and the representative rather than the leads:
 * a list of forty names is not something anyone reads before confirming, and the
 * count is the fact that decides whether the admin selected what they meant to.
 * It also names the rep's email, because two people in one agency can share a
 * display name — which is exactly how the transfer flow became confusing.
 */
export default function BulkAssignLeadsForm({
  count,
  onAssign,
  onCancel,
}: {
  count: number
  onAssign: (userId: number) => void
  onCancel: () => void
}) {
  const t = useT()
  const { users } = useProps()
  const [pending, setPending] = useState<{ userId: number; label: string } | null>(null)

  function onSubmit(e: any) {
    e.preventDefault()
    const data = getFormData2(e) as any
    const userId = Number(data.userId)
    if (!userId) return
    const picked = (users ?? []).find((u: any) => Number(u.id) === userId)
    // Email disambiguates a shared display name; falls back to the name alone.
    const label = picked?.email ? `${picked.name} (${picked.email})` : (picked?.name ?? '')
    setPending({ userId, label })
  }

  return (
    <div>
      <Title lbl={count === 1 ? t('leads.dialog.assignOne') : t('leads.assign.titleMany', { count: String(count) })} className='mb-6' />
      <form onSubmit={onSubmit}>
        <SelectSearch name='userId' lbl={t('leads.assign.pickRep')} options={users} />
        <div className='flex gap-2 mt-8'>
          <Btn lbl={t('leads.assign.submit')} className='w-full' icon='user-check' />
          <Btn lbl={t('leads.assign.cancel')} variant='outline' type='button' className='w-full' onClick={onCancel} />
        </div>
      </form>
      <ConfirmPop
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => {
          const target = pending?.userId
          setPending(null)
          if (target) onAssign(target)
        }}
        msg={
          count === 1
            ? t('leads.assign.confirmOne', { rep: `${pending?.label}` })
            : t('leads.assign.confirmMany', { count: String(count), rep: `${pending?.label}` })
        }
        translated
      />
    </div>
  )
}
