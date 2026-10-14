import type { ReadinessFieldValue, ReadinessView } from '@/lib/whatsapp/platform/readinessView'

/**
 * Renders an allowlisted readiness result (see toReadinessView). Presentational
 * only: it receives no token, secret or raw Meta data, and has no actions.
 * Status is always spelled out in text, never colour alone.
 */
function display(value: ReadinessFieldValue): string {
  if (value === true) return 'כן'
  if (value === false) return 'לא'
  return String(value)
}

function Badge({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${ok ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
      {ok ? okText : badText}
    </span>
  )
}

export default function WhatsappReadinessView({ view, checkedAt }: { view: ReadinessView | null; checkedAt: string }) {
  if (!view) {
    return (
      <p role='alert' className='rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900'>
        לא ניתן היה להשלים את בדיקת המוכנות. נסו לטעון את הדף שוב.
      </p>
    )
  }
  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center gap-3'>
        <Badge ok={view.ready} okText='מוכן לשליחה' badText='לא מוכן לשליחה' />
        <span className='text-sm text-gray-500'>נבדק ב-{checkedAt}. הבדיקה קוראת נתונים מ-Meta בלבד ואינה שולחת הודעות.</span>
      </div>
      {view.checks.map((check) => (
        <section key={check.name} aria-labelledby={`readiness-${check.name}`} className='overflow-hidden rounded-2xl border border-gray-200 bg-white'>
          <header className='flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3'>
            <h2 id={`readiness-${check.name}`} className='text-sm font-semibold text-gray-900'>
              {check.label}
            </h2>
            <Badge ok={check.ok} okText='תקין' badText='לא תקין' />
          </header>
          {check.fields.length ? (
            <table className='w-full text-sm'>
              <caption className='sr-only'>{check.label}</caption>
              <tbody>
                {check.fields.map((f) => (
                  <tr key={f.key} className='border-t border-gray-100 first:border-t-0'>
                    <th scope='row' className='w-1/2 px-4 py-2 text-right font-normal text-gray-600'>
                      {f.label}
                    </th>
                    <td className='px-4 py-2 text-gray-900' dir='ltr'>
                      {display(f.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className='px-4 py-3 text-sm text-gray-500'>אין פרטים נוספים לבדיקה זו.</p>
          )}
        </section>
      ))}
    </div>
  )
}
