import { STATUS_LIST } from '@/types/lists'
import { Select } from '@/lib/form'

export function saleTableHeaders(user) {
  // SocialCRM simplified view — insurance-era columns hidden via noShow (kept in code, toggleable via ShowColumns).
  let columns = [
    { key: 'offrDt', label: 'תאריך פנייה', format: 'formatDate', noShow: true },
    { key: 'clientData', label: 'לקוח' },
    { key: 'status', label: 'סטטוס', format: 'selectStatus' },
    { key: 'company', label: 'ספק', noShow: true },
    { key: 'prdct', label: 'שירות', noShow: true },
    { key: 'userName', label: 'נציג', noShow: true },
    { key: 'amount', label: 'סכום עסקה', format: 'formatCurrency' },
    { key: 'saleDt', label: 'תאריך עסקה', format: 'formatDate' },
    { key: 'action', label: 'סוג', noShow: true },
    { key: 'handlerName', label: 'אחראי' },
    { key: 'leadSource', label: 'מקור', noShow: true },
    { key: 'bizName', label: 'שם עסק', noShow: true },
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
