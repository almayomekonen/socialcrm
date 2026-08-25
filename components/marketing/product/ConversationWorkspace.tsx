import { APP, ChannelMark, Initial, StatusPill } from './chrome'

/**
 * The WhatsApp conversation surface, with the lead's context beside it.
 *
 * Every state shown is one the product actually persists. The delivery ticks
 * use the real message-status vocabulary from `lib/whatsapp/`:
 * pending → sent → delivered → read → failed. Nothing here implies a state the
 * webhook does not report.
 *
 * Mobile drops the context rail entirely rather than squeezing two panes into
 * 390px — the conversation is the point, and a 140px-wide sidebar would be
 * noise at any type size.
 */

type Msg = { from: 'them' | 'us'; text: string; at: string; status?: 'sent' | 'delivered' | 'read' }

const THREAD: Msg[] = [
  { from: 'them', text: 'היי, ראיתי את המודעה. אפשר לקבל פרטים?', at: '09:41' },
  { from: 'us', text: 'בוקר טוב דני! בשמחה. מה בדיוק חיפשת?', at: '09:44', status: 'read' },
  { from: 'them', text: 'מעוניין בהצעת מחיר לשיפוץ מטבח', at: '09:52' },
  { from: 'us', text: 'מעולה. שולח לך עכשיו הצעה מסודרת.', at: '10:03', status: 'delivered' },
]

/** WhatsApp delivery ticks. `read` is the double-blue the product records. */
function Ticks({ status }: { status: NonNullable<Msg['status']> }) {
  const label = { sent: 'נשלח', delivered: 'נמסר', read: 'נקרא' }[status]
  const color = status === 'read' ? '#53bdeb' : 'rgba(255,255,255,0.72)'
  return (
    <span className='inline-flex items-center gap-0.5' title={label}>
      <span className='sr-only'>{label}</span>
      <svg aria-hidden='true' viewBox='0 0 16 11' className='h-2.5 w-4' fill='none'>
        <path d='M1 6.2 3.4 8.6 8.6 2.4' stroke={color} strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
        {status !== 'sent' && (
          <path d='M6.4 6.2 8.8 8.6 14 2.4' stroke={color} strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
        )}
      </svg>
    </span>
  )
}

export function ConversationWorkspace({ chatOnly = false }: { chatOnly?: boolean }) {
  return (
    <div
      dir='rtl'
      className={`grid text-[13px] ${chatOnly ? '' : 'lg:grid-cols-[1fr_260px]'}`}
      style={{ backgroundColor: APP.bg, color: APP.ink }}
    >
      {/* Thread */}
      <div className='flex flex-col'>
        <div
          className='flex items-center gap-2.5 border-b px-4 py-2.5'
          style={{ backgroundColor: APP.surface, borderColor: APP.border }}
        >
          <Initial name='דני לוי' />
          <div className='min-w-0'>
            <p className='truncate font-semibold'>דני לוי</p>
            <p className='truncate text-[11.5px]' style={{ color: APP.faint }}>
              וואטסאפ · 052-000-0000
            </p>
          </div>
          <span className='ms-auto'>
            <ChannelMark channel='whatsapp' size={20} />
          </span>
        </div>

        <div className='flex flex-col gap-2 p-4'>
          {THREAD.map((m, i) => (
            <div
              key={i}
              className={`flex max-w-[82%] flex-col gap-1 rounded-xl px-3 py-2 ${m.from === 'us' ? 'ms-auto items-start' : 'me-auto'}`}
              style={
                m.from === 'us'
                  ? { backgroundColor: APP.primary, color: '#fff' }
                  : { backgroundColor: APP.surface, border: `1px solid ${APP.border}` }
              }
            >
              <span className='text-[12.5px] leading-relaxed'>{m.text}</span>
              <span
                className='flex items-center gap-1 self-end text-[10.5px]'
                style={{ color: m.from === 'us' ? 'rgba(255,255,255,0.75)' : APP.faint }}
              >
                {m.at}
                {m.status && <Ticks status={m.status} />}
              </span>
            </div>
          ))}
        </div>

        <div
          className='mt-auto flex items-center gap-2 border-t px-4 py-2.5'
          style={{ backgroundColor: APP.surface, borderColor: APP.border }}
        >
          <span
            className='flex-1 rounded-full px-3 py-1.5 text-[12px]'
            style={{ backgroundColor: APP.bg, color: APP.muted }}
          >
            כתוב הודעה…
          </span>
          <span
            className='shrink-0 rounded-md px-2.5 py-1.5 text-[11.5px] font-medium'
            style={{ backgroundColor: APP.primarySoft, color: APP.primaryText }}
          >
            תבנית
          </span>
        </div>
      </div>

      {/* Lead context — desktop only, and dropped entirely when chatOnly. */}
      {!chatOnly && <aside
        className='hidden flex-col gap-3 border-s p-4 lg:flex'
        style={{ backgroundColor: APP.surface, borderColor: APP.border }}
      >
        <p className='text-[11px] font-semibold' style={{ color: APP.faint }}>
          הליד
        </p>
        <StatusPill status='contacted' />
        <dl className='flex flex-col gap-2.5 text-[12px]'>
          {[
            ['מקור', 'וואטסאפ'],
            ['נציג', 'יוסי כהן'],
            ['מעקב הבא', 'היום, 14:00'],
            ['נפתח', 'לפני 6 ימים'],
          ].map(([k, v]) => (
            <div key={k} className='flex items-center justify-between gap-2'>
              <dt style={{ color: APP.faint }}>{k}</dt>
              <dd className='font-medium'>{v}</dd>
            </div>
          ))}
        </dl>
      </aside>}
    </div>
  )
}
