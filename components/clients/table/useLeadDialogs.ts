'use client'

import { useState } from 'react'
import type { LeadActionCode } from './leadActions'

export type LeadDialogName = 'form' | 'transfer' | 'sale' | 'upload'

/** Which dialog a row action opens — by CODE, never by the menu's label. */
const ROW_ACTION_DIALOG: Record<LeadActionCode, LeadDialogName> = { edit: 'form', deal: 'sale', transfer: 'transfer' }

/** The row the menu / dialogs act on, and which of the table's dialogs are open. */
export function useLeadDialogs() {
  const [curClient, setCurClient] = useState<any>(null)
  const [open, setOpen] = useState<Record<LeadDialogName, boolean>>({ form: false, transfer: false, sale: false, upload: false })

  const show = (dialog: LeadDialogName) => setOpen((o) => ({ ...o, [dialog]: true }))

  /** Closing the form, transfer or deal dialog also releases the current row; import has none. */
  function close(dialog: LeadDialogName) {
    if (dialog !== 'upload') setCurClient(null)
    setOpen((o) => ({ ...o, [dialog]: false }))
  }

  return {
    curClient,
    setCurClient,
    open,
    show,
    close,
    /** "ליד חדש" / "הוסף ליד": the form, with no row. */
    openAddForm: () => (show('form'), setCurClient(null)),
    openForAction: (code: LeadActionCode) => show(ROW_ACTION_DIALOG[code]),
  }
}
