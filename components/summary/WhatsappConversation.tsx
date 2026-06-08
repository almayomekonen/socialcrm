import { formatDate } from '@/lib/dates'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'
import WhatsappReplyDraft from '@/components/summary/WhatsappReplyDraft'

export default function WhatsappConversation({
  messages,
  leadId,
}: {
  messages: LeadWhatsappMessage[]
  leadId: number
}) {

  const last = messages.length > 0 ? messages[messages.length - 1] : null
  const attention =
    last === null
      ? null
      : last.direction === 'inbound'
        ? { label: 'דורש מענה', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' }
        : { label: 'הנציג השיב לאחרונה', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500' }

  return (
    <div className='xl:p-8'>
      <div className='flex items-center gap-2 my-4'>
        <h1 className='text-2xl font-bold'>שיחת WhatsApp</h1>
        {attention && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${attention.bg} ${attention.text} ${attention.border}`}
          >
            <span className={`size-1.5 rounded-full ${attention.dot}`} />
            {attention.label}
          </span>
        )}
      </div>
      {messages.length === 0 ? (
        <div className='text-center py-12 text-gray-400'>
          <p className='text-base'>אין הודעות WhatsApp עדיין</p>
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-2 my-4'>
          {messages.map((m) => (
            <div key={m.id} className='bg-white px-4 py-2 border rounded'>
              <div className='flex items-center justify-between gap-3'>
                <span className='text-xs text-gray-500'>{m.direction === 'inbound' ? 'מהליד' : 'נשלח'}</span>
                <span className='text-xs text-gray-500 tabular-nums'>{formatDate(m.timestamp)}</span>
              </div>
              <p className='text-sm text-gray-800 mt-1 whitespace-pre-wrap wrap-break-word'>{m.text || '—'}</p>
            </div>
          ))}
        </div>
      )}
      <WhatsappReplyDraft leadId={leadId} />
    </div>
  )
}
