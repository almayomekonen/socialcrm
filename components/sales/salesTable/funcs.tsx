import { Select } from '@/lib/form'
import { checkedIds } from '@/lib/table/funcs'
import { Btn } from '@/lib/btns/Btn'
import { setPosAndPop } from '@/lib/funcs'
import { addFavDeals, deleteDeal, removeFavDeal } from '@/actions/salesTbl'
import { api } from '@/lib/funcs'
import { toast } from '@/lib/toast'

export const getActions = () => ({
  מחיקה: {
    func: onDel,
  },
  עריכה: {
    func: () => {},
  },

  'הוספה למועדפים': {
    func: addOrRemoveFav,
  },
})

export function SelectSalesGrpActions({ user, isFav = null }) {
  const onGroupAction = async (e) => {
    const val = e.target.value
    const ids = checkedIds()

    e.target.value = ''
    if (!ids.length) return alert('לא נבחרו רשומות מהטבלה')
    await getActions()[val].func(ids, user)
  }

  return <Select options={Object.keys(getActions())} placeholder='פעולות' onChange={onGroupAction} />
}

export function DotsMenu({ id, onClick }) {
  return (
    <Btn variant='outline' size='icon' icon='ellipsis-vertical' type='button' onClick={(e) => setPosAndPop(e, id, onClick)} />
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

async function onDel(sale) {
  console.log('onDel: ', sale)
  if (!confirm(`בטוח למחוק דיל של ${sale?.clientData} ?`)) return
  await api(deleteDeal, sale?.id, 'הדיל נמחק בהצלחה')
}
function addOrRemoveFav(sale, isFav) {
  if (isFav) {
    removeFavDeal(sale.id)
    toast('success', 'הדיל הוסר ממועדפים')
  } else {
    addFavDeals([sale.id])
    toast('success', 'הדיל נוסף למועדפים')
  }
}
