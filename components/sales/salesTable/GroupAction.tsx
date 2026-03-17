import { STATUS_LIST } from '@/types/lists'
import { toast } from '@/lib/toast'
import { checkedIds } from '@/lib/table/funcs'
import { addFavSales, deleteSales, removeFavSales, updateManySaleStatus } from '@/actions/salesTbl'
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
    { head: 'מחיקה', grp: ['מחיקת המכירות'] },
    { head: 'מועדפים', grp: isFav ? ['הסרה ממועדפים'] : ['הוספה למועדפים'] },
  ]
  return <Select options={selectGrp} onChange={onGroupAction} placeholder='פעולות' className='w-32' />
}

const actions = {
  'מחיקת המכירות': async (ids) => {
    if (!confirm('בטוח למחוק את המכירות?')) return
    toast('loading')
    const rowsDeleted = await deleteSales(ids)
    rowsDeleted > 0 ? toast('success', 'המכירות נמחקו בהצלחה') : toast('error', 'שגיאה, המכירות לא נמחקו')
  },
  'הוספה למועדפים': async (ids) => {
    toast('loading')
    if (!confirm('בטוח להוסיף את המכירות למועדפים?')) return
    await addFavSales(ids)
    toast('success', 'המכירות נוספו למועדפים')
  },
  'הסרה ממועדפים': async (ids) => {
    toast('loading')
    if (!confirm('בטוח להסיר את המכירות ממועדפים?')) return
    await removeFavSales(ids)
    toast('success', 'המכירות הוסרו ממועדפים')
  },
  default: async (ids, val) => {
    if (!confirm('לשנות את סטטוס המכירות ל' + val + '?')) return
    toast('loading')
    await updateManySaleStatus(ids, val)
    toast('success', 'סטטוס עודכן בהצלחה')
  },
}
