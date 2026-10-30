'use client'
import { useState } from 'react'
import { STATUS_LIST } from '@/types/lists'
import { toast } from '@/lib/toast'
import { checkedIds } from '@/lib/table/funcs'
import { addFavDeals, deleteDeals, removeFavDeals, updateManyDealStatus } from '@/actions/salesTbl'
import { Select } from '@/lib/form'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'
import { dealStatusLabel } from '@/lib/deals/labels'

type ActionKey = 'delete' | 'addFav' | 'removeFav' | 'status'
type Pending = { key: ActionKey; ids: number[]; val: string }

/**
 * Option VALUES are the Hebrew action codes (and the stored statuses) this
 * component has always switched on; only their visible text is translated.
 */
const DELETE = 'מחיקת העסקאות'
const ADD_FAV = 'הוספה למועדפים'
const REMOVE_FAV = 'הסרה ממועדפים'

export default function GroupAction({ isFav }) {
  const t = useT()
  const [pending, setPending] = useState<Pending | null>(null)

  const onGroupAction = (e) => {
    const val = e.target.value
    const ids = checkedIds()
    e.target.value = ''

    if (!ids.length) return

    const key: ActionKey =
      val === DELETE
        ? 'delete'
        : val === ADD_FAV
          ? 'addFav'
          : val === REMOVE_FAV
            ? 'removeFav'
            : 'status'
    setPending({ key, ids, val })
  }

  const msg =
    pending?.key === 'delete'
      ? t('deals.group.confirm.delete')
      : pending?.key === 'addFav'
        ? t('deals.group.confirm.addFavorite')
        : pending?.key === 'removeFav'
          ? t('deals.group.confirm.removeFavorite')
          : pending
            ? t('deals.group.confirm.status', { status: dealStatusLabel(pending.val, t.locale) })
            : ''

  async function runPending() {
    if (!pending) return
    const { key, ids, val } = pending
    setPending(null)

    if (key === 'delete') {
      toast('loading')
      const rowsDeleted = await deleteDeals(ids)
      rowsDeleted > 0 ? toast('success', t('deals.group.toast.deleted')) : toast('error', t('deals.group.toast.deleteFailed'))
      return
    }
    if (key === 'addFav') {
      toast('loading')
      await addFavDeals(ids)
      toast('success', t('deals.group.toast.favoritesAdded'))
      return
    }
    if (key === 'removeFav') {
      toast('loading')
      await removeFavDeals(ids)
      toast('success', t('deals.group.toast.favoritesRemoved'))
      return
    }
    toast('loading')
    await updateManyDealStatus(ids, val)
    toast('success', t('deals.group.toast.statusUpdated'))
  }

  // `{ id: code, name: text }`: Hebrew renders exactly the same options as before.
  const opt = (id: string, name: string) => ({ id, name })
  const selectGrp = [
    { head: t('deals.group.statusHead'), grp: STATUS_LIST.map((s) => opt(s, dealStatusLabel(s, t.locale))) },
    { head: t('deals.group.deleteHead'), grp: [opt(DELETE, t('deals.group.delete'))] },
    {
      head: t('deals.group.favoritesHead'),
      grp: isFav ? [opt(REMOVE_FAV, t('deals.group.removeFavorite'))] : [opt(ADD_FAV, t('deals.group.addFavorite'))],
    },
  ]

  return (
    <>
      <Select options={selectGrp} onChange={onGroupAction} placeholder={t('deals.group.placeholder')} className='w-32' />
      <ConfirmPop
        open={!!pending}
        destructive={pending?.key === 'delete'}
        onClose={() => setPending(null)}
        onConfirm={runPending}
        msg={msg}
        translated
      />
    </>
  )
}
