import { STATUS_LIST } from '@/types/lists'
import { Select } from '@/lib/form'

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
