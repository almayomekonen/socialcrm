import { deleteLead } from '../../actions/clients'
import { api } from '@/lib/funcs'
import { Select } from '@/lib/form'
import { checkedIds } from '@/lib/table/funcs'
import { Btn } from '@/lib/btns/Btn'
import { setPosAndPop } from '@/lib/funcs'

export const getActions = () => ({
  // מחיקה: {
  //   func: onDel,
  // },

  עריכה: {
    func: () => {},
  },

  // 'העברת מכירות ללקוח אחר': {
  //   func: onTransferSales,
  // },

  'העברת ליד לנציג אחר': {
    func: () => {},
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
  if (res?.err) return alert('לא ניתן למחוק ליד עם דילים, העבר את הדילים לליד אחר ונסה שוב')
}

async function onTransferSales(client) {
  console.log('onTransferSales: ', client)
}

export const RANK_MAP: Record<string, { label: string; dot: string; color: string }> = {
  '1': { label: 'חדש', dot: 'from-blue-300 via-blue-500 to-blue-700 shadow-blue-400/40', color: '#3b82f6' },
  '2': { label: 'דיברתי', dot: 'from-yellow-300 via-yellow-500 to-yellow-600 shadow-yellow-500/40', color: '#eab308' },
  '3': { label: 'בשיחה', dot: 'from-orange-300 via-orange-500 to-orange-700 shadow-orange-500/40', color: '#f97316' },
  '4': { label: 'מתעניין', dot: 'from-green-300 via-green-500 to-green-700 shadow-green-500/40', color: '#22c55e' },
  '5': { label: 'סגור', dot: 'from-gray-300 via-gray-400 to-gray-600 shadow-gray-400/40', color: '#9ca3af' },
  '6': { label: 'אבוד', dot: 'from-red-300 via-red-500 to-red-700 shadow-red-500/40', color: '#ef4444' },
}

export function FormatRank({ rank }) {
  const mapped = RANK_MAP[String(rank)]
  if (!mapped) return null
  return (
    <span className='inline-flex items-center gap-1.5 whitespace-nowrap'>
      <span className={`shrink-0 w-2.5 h-2.5 rounded-full bg-linear-to-br shadow-sm ${mapped.dot}`} />
      <span className='text-xs font-medium text-gray-700'>{mapped.label}</span>
    </span>
  )
}
