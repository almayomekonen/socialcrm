import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

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

/** Header text by column KEY in the interface language (the stored `label` is what Hebrew shows); null for an unknown key. */
const DEAL_HEADER_KEY: Record<string, MessageKey> = {
  offrDt: 'deals.table.header.offrDt',
  clientData: 'deals.table.header.clientData',
  status: 'deals.table.header.status',
  company: 'deals.table.header.company',
  prdct: 'deals.table.header.prdct',
  userName: 'deals.table.header.userName',
  amount: 'deals.table.header.amount',
  saleDt: 'deals.table.header.saleDt',
  action: 'deals.table.header.action',
  handlerName: 'deals.table.header.handlerName',
  leadSource: 'deals.table.header.leadSource',
  bizName: 'deals.table.header.bizName',
  notes: 'deals.table.header.notes',
}

export function dealColumnLabel(key: string, locale: UiLocale): string | null {
  const k = DEAL_HEADER_KEY[key]
  return k ? translatorFor(locale)(k) : null
}
