import { deleteClient } from '../../actions/clients'
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

  'העברת לקוח לנציג אחר': {
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
  if (!confirm(`האם למחוק לקוח ${client.name} ?`)) return
  const res = await api(deleteClient, client.id)
  if (res?.err) return alert('לא ניתן למחוק לקוח עם מכירות, העבר את המכירות ללקוח אחר ונסה שוב')
}

async function onTransferSales(client) {
  console.log('onTransferSales: ', client)
}

export function FormatRank({ rank }) {
  const colors = {
    '1': ' from-yellow-300 via-yellow-500 to-yellow-700 shadow-yellow-500/30',
    '2': ' from-gray-300 via-gray-400 to-gray-600 shadow-gray-400/30',
    '3': ' from-amber-600 via-orange-800 to-amber-900 shadow-xl shadow-amber-700/30',
  }

  return <div className={`w-3 h-3 rounded-full bg-linear-to-br ${colors[rank]}`} />
}
