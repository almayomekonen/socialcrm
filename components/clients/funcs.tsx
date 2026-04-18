import { deleteLead } from '../../actions/clients'
import { api } from '@/lib/funcs'
import { Select } from '@/lib/form'
import { checkedIds } from '@/lib/table/funcs'
import { Btn } from '@/lib/btns/Btn'
import { setPosAndPop } from '@/lib/funcs'

export function getDealActionLabel(status?: string) {
  if (status === 'closed') return 'הוסף עסקה נוספת'
  if (status === 'lost') return 'הוסף עסקה (ליד אבוד)'
  return 'סגור עסקה'
}

export const DEAL_ACTION_LABELS: string[] = [
  'סגור עסקה',
  'הוסף עסקה נוספת',
  'הוסף עסקה (ליד אבוד)',
]

export const getActions = (status?: string) => ({
  // מחיקה: {
  //   func: onDel,
  // },

  עריכה: {
    func: (..._args: any[]) => {},
  },

  [getDealActionLabel(status)]: {
    func: (..._args: any[]) => {},
  },

  'העברת ליד לנציג אחר': {
    func: (..._args: any[]) => {},
  },
})

export function SelectClientGrpActions({ user }) {
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

async function onDel(client) {
  if (!confirm(`האם למחוק ליד ${client.name} ?`)) return
  const res = await api(deleteLead, client.id)
  if (res?.err) return alert('לא ניתן למחוק ליד עם עסקאות, העבר את העסקאות לליד אחר ונסה שוב')
}
