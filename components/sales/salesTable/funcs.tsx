'use client'
import { useState } from 'react'
import { Select } from '@/lib/form'
import { checkedIds } from '@/lib/table/funcs'
import { Btn } from '@/lib/btns/Btn'
import { setPosAndPop } from '@/lib/funcs'
import { addFavDeals, removeFavDeal } from '@/actions/salesTbl'
import { toast } from '@/lib/toast'
import ConfirmPop from '@/lib/modals/ConfirmPop'

export const getActions = () => ({
  מחיקה: {
    // Deletion UX is owned by `SalesTable` via `ConfirmPop` (lbl intercept).
    func: (..._args: any[]) => {},
  },
  עריכה: {
    func: () => {},
  },

  'הוספה למועדפים': {
    func: addOrRemoveFav,
  },
})

export function SelectSalesGrpActions({ user, isFav = null }) {
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const onGroupAction = async (e) => {
    const val = e.target.value
    const ids = checkedIds()

    e.target.value = ''
    if (!ids.length) return setErrMsg('לא נבחרו רשומות מהטבלה')
    await getActions()[val].func(ids, user)
  }

  return (
    <>
      <Select options={Object.keys(getActions())} placeholder='פעולות' onChange={onGroupAction} />
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
      />
    </>
  )
}

export function DotsMenu({ id, onClick }) {
  return (
    <Btn variant='outline' size='icon' icon='ellipsis-vertical' type='button' aria-label='פעולות' aria-haspopup='menu' onClick={(e) => setPosAndPop(e, id, onClick)} />
  )
}

export function ActionsMenu({ id, children }) {
  const closeOnScroll = () => {
    document.getElementById(id)?.hidePopover()
  }

  function onToggle(e) {
    if (e.target.matches(':popover-open')) document.addEventListener('scroll', closeOnScroll, { passive: true, capture: true })
    else document.removeEventListener('scroll', closeOnScroll, { capture: true })
  }

  return (
    <div popover='auto' id={id} className='popanchor border shadow-3 rounded-md' onToggle={onToggle}>
      {children}
    </div>
  )
}

// ------------------------------
// Functions
// ------------------------------

// `onDel` (sale delete) is owned by `SalesTable` via `ConfirmPop`.
function addOrRemoveFav(sale, isFav) {
  if (isFav) {
    removeFavDeal(sale.id)
    toast('success', 'העסקה הוסרה ממועדפים')
  } else {
    addFavDeals([sale.id])
    toast('success', 'העסקה נוספה למועדפים')
  }
}
