'use client'
import { useState } from 'react'
import { Select } from '@/lib/form'
import { checkedIds } from '@/lib/table/funcs'
import { Btn } from '@/lib/btns/Btn'
import { setPosAndPop } from '@/lib/funcs'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { groupActionCode, leadGroupActions, type LeadActionCode } from './table/leadActions'

export { getDealActionLabel } from './table/leadActions'

/**
 * Group actions by CODE. None of them does anything yet — this is the existing
 * behaviour (every group handler was an empty function), kept as is.
 */
const GROUP_ACTION_HANDLERS: Record<LeadActionCode, (ids: number[], user: unknown) => void | Promise<void>> = {
  edit: () => {},
  deal: () => {},
  transfer: () => {},
}

export function SelectClientGrpActions({ user }) {
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const onGroupAction = async (e) => {
    const val = e.target.value
    const ids = checkedIds()

    e.target.value = ''
    if (!ids.length) return setErrMsg('לא נבחרו רשומות מהטבלה')
    const code = groupActionCode(val)
    if (code) await GROUP_ACTION_HANDLERS[code](ids, user)
  }

  return (
    <>
      <Select options={leadGroupActions().map((a) => a.label)} placeholder='פעולות' onChange={onGroupAction} />
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
