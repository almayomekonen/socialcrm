'use client'

/**
 * The phone import's two result views (extracted from `LeadImportMobile`, no
 * behaviour change): the Excel preview before importing, and the CSV summary
 * after `importLeadsFromCsv` has run.
 */

export type ExcelPreview = {
  valid: Record<string, any>[]
  invalid: Record<string, any>[]
}

export type CsvResult = { inserted: number; updated: number; unchanged: number; invalid: number }

function rowLabel(row: Record<string, any>) {
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ')
  return name || 'שורה לא תקינה'
}

export function ExcelPreviewMobile({ excel, busy, onConfirm }: { excel: ExcelPreview; busy: boolean; onConfirm: () => void }) {
  const found = excel.valid.length + excel.invalid.length
  return (
    <div className='mt-5 flex flex-col gap-3'>
      <p className='text-base font-semibold text-ink'>{`מצאנו ${found} לידים`}</p>
      <p className='text-sm text-gray-700'>{`${excel.valid.length} תקינים`}</p>
      <p className='text-sm text-gray-700'>{`${excel.invalid.length} דורשים בדיקה`}</p>
      {excel.invalid.length > 0 && (
        <ul className='flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200'>
          {excel.invalid.slice(0, 30).map((row, i) => (
            <li key={i} className='px-3 py-2'>
              <p className='text-sm font-medium text-ink'>{rowLabel(row)}</p>
              {row.idNum != null && row.idNum !== '' && <p className='text-xs text-gray-500'>{String(row.idNum)}</p>}
            </li>
          ))}
        </ul>
      )}
      <button
        type='button'
        disabled={busy || excel.valid.length === 0}
        className='press flex min-h-12 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        onClick={onConfirm}
      >
        {excel.valid.length ? `ייבא ${excel.valid.length} לידים` : 'אין לידים לייבוא'}
      </button>
    </div>
  )
}

export function CsvSummary({ result }: { result: CsvResult }) {
  const { inserted, updated, unchanged, invalid } = result
  let headline = 'לא נוספו לידים'
  if (inserted === 0 && unchanged > 0) headline = 'כל הלידים כבר קיימים במערכת'
  else if (inserted > 0 && unchanged > 0) headline = `נוספו ${inserted} לידים חדשים`
  else if (inserted > 0) headline = 'כל הלידים נוספו בהצלחה'

  return (
    <div className='mt-5 flex flex-col gap-1.5 text-sm'>
      <p className='font-semibold text-ink'>{headline}</p>
      {unchanged > 0 && inserted > 0 && <p className='text-gray-600'>{`${unchanged} לידים כבר קיימים ולא שונו`}</p>}
      {updated > 0 && <p className='text-gray-600'>{`עודכנו פרטים ב-${updated} לידים קיימים`}</p>}
      {invalid > 0 && <p className='text-gray-600'>{`שורות לא תקינות: ${invalid}`}</p>}
    </div>
  )
}
