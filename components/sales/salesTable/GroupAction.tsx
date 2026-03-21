import { STATUS_LIST } from '@/types/lists'
import { toast } from '@/lib/toast'
import { checkedIds } from '@/lib/table/funcs'
import { addFavDeals, deleteDeals, removeFavDeals, updateManyDealStatus } from '@/actions/salesTbl'
import { Select } from '@/lib/form'

export default function GroupAction({ isFav }) {
  const onGroupAction = async (e) => {
    const val = e.target.value
    const ids = checkedIds()
    e.target.value = ''

    const action = actions[val] || actions['default']
    await action(ids, val)
  }

  const selectGrp = [
    { head: 'עדכון סטטוס', grp: STATUS_LIST },
    { head: 'מחיקה', grp: ['מחיקת הדילים'] },
    { head: 'מועדפים', grp: isFav ? ['הסרה ממועדפים'] : ['הוספה למועדפים'] },
  ]
  return <Select options={selectGrp} onChange={onGroupAction} placeholder='פעולות' className='w-32' />
}

const actions = {
  'מחיקת הדילים': async (ids) => {
    if (!confirm('בטוח למחוק את הדילים?')) return
    toast('loading')
    const rowsDeleted = await deleteDeals(ids)
    rowsDeleted > 0 ? toast('success', 'הדילים נמחקו בהצלחה') : toast('error', 'שגיאה, הדילים לא נמחקו')
  },
  'הוספה למועדפים': async (ids) => {
    toast('loading')
    if (!confirm('בטוח להוסיף את הדילים למועדפים?')) return
    await addFavDeals(ids)
    toast('success', 'הדילים נוספו למועדפים')
  },
  'הסרה ממועדפים': async (ids) => {
    toast('loading')
    if (!confirm('בטוח להסיר את הדילים ממועדפים?')) return
    await removeFavDeals(ids)
    toast('success', 'הדילים הוסרו ממועדפים')
  },
  default: async (ids, val) => {
    if (!confirm('לשנות את סטטוס הדילים ל' + val + '?')) return
    toast('loading')
    await updateManyDealStatus(ids, val)
    toast('success', 'סטטוס עודכן בהצלחה')
  },
}
