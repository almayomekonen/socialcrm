import { STATUS_LIST } from '@/types/lists'
import { Select } from '@/lib/form'

// import { isAdmin, Roles } from '@/db/types'

export function saleTableHeaders(user) {
  let columns = [
    { key: 'offrDt', label: 'תאריך פנייה', format: 'formatDate' },
    { key: 'clientData', label: 'לקוח' },
    { key: 'status', label: 'סטטוס', format: 'selectStatus' },
    { key: 'company', label: 'ספק' },
    { key: 'prdct', label: 'שירות' },
    { key: 'userName', label: 'נציג' },
    { key: 'amount', label: 'סכום עסקה', format: 'formatCurrency' },
    { key: 'saleDt', label: 'תאריך עסקה', format: 'formatDate' },
    { key: 'action', label: 'סוג' },
    { key: 'handlerName', label: 'אחראי' },
    { key: 'leadSource', label: 'מקור' },
    { key: 'bizName', label: 'שם עסק' },
    { key: 'notes', label: 'הערות', format: 'notesBtn', noShow: true },
  ]

  // if (isAdmin(user.role)) {
  //   const adminColumns = [
  //     { key: 'agencyMonthlyCmsn', label: 'נפרעים סוכנות', format: 'formatCurrency' },
  //     { key: 'agencyYearlyCmsn', label: 'היקף סוכנות', format: 'formatCurrency' },
  //     { key: 'mngrMonthlyCmsn', label: 'נפרעים מפקח', format: 'formatCurrency' },
  //     { key: 'mngrYearlyCmsn', label: 'היקף מפקח', format: 'formatCurrency' },
  //   ]

  //   columns = [...columns, ...adminColumns]
  // }

  // if (user.role === Roles.MNGR) {
  //   const mngrColumns = [
  //     { key: 'mngrMonthlyCmsn', label: 'נפרעים מפקח', format: 'formatCurrency' },
  //     { key: 'mngrYearlyCmsn', label: 'היקף מפקח', format: 'formatCurrency' },
  //   ]

  //   columns = [...columns, ...mngrColumns]
  // }

  return columns
}

export function notesBtn(note, el) {
  return (
    <>
      {note && (
        <>
          <button popoverTarget={'notesPop' + el?.id}>
            <p className='underline hover:text-blue-800'>{note}</p>
          </button>
          <div className='pop' popover='auto' id={'notesPop' + el?.id}>
            <p className='whitespace-pre-wrap'>{note}</p>
          </div>
        </>
      )}
    </>
  )
}
