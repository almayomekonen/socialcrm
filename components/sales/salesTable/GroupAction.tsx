'use client'
import { useState } from 'react'
import { STATUS_LIST } from '@/types/lists'
import { toast } from '@/lib/toast'
import { checkedIds } from '@/lib/table/funcs'
import { addFavDeals, deleteDeals, removeFavDeals, updateManyDealStatus } from '@/actions/salesTbl'
import { Select } from '@/lib/form'
import ConfirmPop from '@/lib/modals/ConfirmPop'

type ActionKey = 'delete' | 'addFav' | 'removeFav' | 'status'
type Pending = { key: ActionKey; ids: number[]; val: string }

export default function GroupAction({ isFav }) {
  const [pending, setPending] = useState<Pending | null>(null)

  const onGroupAction = (e) => {
    const val = e.target.value
    const ids = checkedIds()
    e.target.value = ''

    if (!ids.length) return

    const key: ActionKey =
      val === 'מחיקת העסקאות'
        ? 'delete'
        : val === 'הוספה למועדפים'
          ? 'addFav'
          : val === 'הסרה ממועדפים'
            ? 'removeFav'
            : 'status'
    setPending({ key, ids, val })
  }

  const msg =
    pending?.key === 'delete'
      ? 'בטוח למחוק את העסקאות?'
      : pending?.key === 'addFav'
        ? 'בטוח להוסיף את העסקאות למועדפים?'
        : pending?.key === 'removeFav'
          ? 'בטוח להסיר את העסקאות ממועדפים?'
          : pending
            ? 'לשנות את סטטוס העסקאות ל' + pending.val + '?'
            : ''

  async function runPending() {
    if (!pending) return
    const { key, ids, val } = pending
    setPending(null)

    if (key === 'delete') {
      toast('loading')
      const rowsDeleted = await deleteDeals(ids)
      rowsDeleted > 0 ? toast('success', 'העסקאות נמחקו בהצלחה') : toast('error', 'שגיאה, העסקאות לא נמחקו')
      return
    }
    if (key === 'addFav') {
      toast('loading')
      await addFavDeals(ids)
      toast('success', 'העסקאות נוספו למועדפים')
      return
    }
    if (key === 'removeFav') {
      toast('loading')
      await removeFavDeals(ids)
      toast('success', 'העסקאות הוסרו ממועדפים')
      return
    }
    toast('loading')
    await updateManyDealStatus(ids, val)
    toast('success', 'סטטוס עודכן בהצלחה')
  }

  const selectGrp = [
    { head: 'עדכון סטטוס', grp: STATUS_LIST },
    { head: 'מחיקה', grp: ['מחיקת העסקאות'] },
    { head: 'מועדפים', grp: isFav ? ['הסרה ממועדפים'] : ['הוספה למועדפים'] },
  ]

  return (
    <>
      <Select options={selectGrp} onChange={onGroupAction} placeholder='פעולות' className='w-32' />
      <ConfirmPop
        open={!!pending}
        destructive={pending?.key === 'delete'}
        onClose={() => setPending(null)}
        onConfirm={runPending}
        msg={msg}
      />
    </>
  )
}
