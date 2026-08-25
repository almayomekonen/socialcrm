import { APP, ChannelMark, Initial, StatusPill, type LeadStatus } from './chrome'

/**
 * The hero product surface: the SocialCRM leads workspace shown as a full
 * application, not a bare table.
 *
 * WHY THIS EXISTS. Lumen's hero image is a complete app — sidebar, search bar,
 * breadcrumb, view tabs, filter row, then the board. Dropping a plain table
 * into that frame reads as a widget rather than as software, and the frame
 * (`bg-background/45`, frosted over the wash) has nothing to sit against. This
 * composes the same product data into the same density.
 *
 * The navigation labels are the application's real ones, read from
 * `lib/navs/Nav.tsx`: היום · לידים · שיחות · עסקאות · משימות · ביצועים.
 * Presentational only — no links, no state, no data access.
 *
 * Mobile: the sidebar and the top-bar utilities are dropped rather than
 * scaled, so nothing renders below ~11px.
 */

type Row = {
  name: string
  channel: 'whatsapp' | 'facebook' | 'instagram'
  status: LeadStatus
  owner: string
  next: string
  urgent?: boolean
  fresh?: boolean
}

const ROWS: Row[] = [
  { name: 'דני לוי', channel: 'whatsapp', status: 'new', owner: 'יוסי כהן', next: 'היום, 14:00', urgent: true, fresh: true },
  { name: 'מיכל אברהם', channel: 'instagram', status: 'contacted', owner: 'רחל גולן', next: 'מחר' },
  { name: 'אבי שרון', channel: 'facebook', status: 'interested', owner: 'יוסי כהן', next: 'יום ג׳' },
  { name: 'שרה פרץ', channel: 'whatsapp', status: 'contacted', owner: 'רחל גולן', next: '18 בספט׳' },
  { name: 'נועם ביטון', channel: 'facebook', status: 'closed', owner: 'יוסי כהן', next: '—' },
  { name: 'לירון כץ', channel: 'instagram', status: 'new', owner: 'לא שויך', next: 'היום' },
  { name: 'תמר אבידן', channel: 'whatsapp', status: 'interested', owner: 'רחל גולן', next: 'יום ה׳' },
]

const NAV = [
  { label: 'היום', badge: '4' },
  { label: 'לידים', active: true },
  { label: 'שיחות', badge: '2' },
  { label: 'עסקאות' },
  { label: 'משימות' },
  { label: 'ביצועים' },
]

const VIEWS = ['רשימה', 'לוח', 'לוח שנה', 'טבלה']

export function LeadsAppShell() {
  return (
    <div
      dir='rtl'
      className='flex text-[13px] leading-normal'
      style={{ backgroundColor: APP.bg, color: APP.ink }}
    >
      {/* Sidebar — dropped below lg rather than shrunk. */}
      <aside
        className='hidden w-[188px] shrink-0 flex-col border-s p-3 lg:flex'
        style={{ backgroundColor: APP.surface, borderColor: APP.border }}
      >
        <div className='flex items-center gap-2 px-1 pb-3'>
          <span
            aria-hidden='true'
            className='grid size-6 place-items-center rounded-md text-[11px] font-bold text-white'
            style={{ backgroundColor: APP.primary }}
          >
            S
          </span>
          <span className='truncate font-semibold'>SocialCRM</span>
        </div>

        <div
          className='mb-3 flex items-center gap-2 rounded-md px-2 py-1.5'
          style={{ backgroundColor: APP.bg }}
        >
          <Initial name='סטודיו' />
          <div className='min-w-0'>
            <p className='truncate text-[12px] font-medium'>הסטודיו של רונית</p>
            <p className='truncate text-[10.5px]' style={{ color: APP.faint }}>
              248 לידים
            </p>
          </div>
        </div>

        <nav className='flex flex-col gap-0.5'>
          {NAV.map((n) => (
            <span
              key={n.label}
              className='flex items-center justify-between rounded-md px-2 py-1.5 text-[12.5px]'
              style={
                n.active
                  ? { backgroundColor: APP.primarySoft, color: APP.primaryText, fontWeight: 600 }
                  : { color: APP.muted }
              }
            >
              {n.label}
              {n.badge && (
                <span
                  className='rounded-full px-1.5 text-[10px] font-semibold'
                  style={{ backgroundColor: n.active ? '#fff' : APP.bg, color: APP.primaryText }}
                >
                  {n.badge}
                </span>
              )}
            </span>
          ))}
        </nav>
      </aside>

      <div className='flex min-w-0 flex-1 flex-col'>
        {/* Top bar */}
        <div
          className='flex items-center gap-3 border-b px-3.5 py-2.5 sm:px-4'
          style={{ backgroundColor: APP.surface, borderColor: APP.border }}
        >
          <span
            className='hidden max-w-[260px] flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] sm:flex'
            style={{ backgroundColor: APP.bg, color: APP.faint }}
          >
            <svg aria-hidden='true' viewBox='0 0 16 16' className='size-3.5' fill='none' stroke='currentColor' strokeWidth='1.6'>
              <circle cx='7' cy='7' r='4.5' />
              <path d='m10.5 10.5 3 3' strokeLinecap='round' />
            </svg>
            חיפוש ליד, טלפון או מקור…
          </span>
          <span className='lg:hidden font-semibold'>הלידים שלי</span>
          <span className='ms-auto flex items-center gap-2'>
            <span
              className='hidden rounded-md px-2.5 py-1.5 text-[11.5px] font-medium sm:inline'
              style={{ border: `1px solid ${APP.border}`, color: APP.muted }}
            >
              ייבוא מאקסל
            </span>
            <span
              className='rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold text-white'
              style={{ backgroundColor: APP.primary }}
            >
              הוסף ליד
            </span>
            <Initial name='רונית' />
          </span>
        </div>

        {/* View tabs */}
        <div
          className='hidden items-center gap-1 border-b px-4 py-1.5 md:flex'
          style={{ backgroundColor: APP.surface, borderColor: APP.border }}
        >
          {VIEWS.map((v, i) => (
            <span
              key={v}
              className='rounded-md px-2.5 py-1 text-[11.5px]'
              style={i === 0 ? { backgroundColor: APP.bg, fontWeight: 600 } : { color: APP.faint }}
            >
              {v}
            </span>
          ))}
          <span className='ms-auto text-[11.5px]' style={{ color: APP.faint }}>
            ממוין לפי: מעקב הבא
          </span>
        </div>

        {/* Filter chips */}
        <div
          className='flex items-center gap-1.5 overflow-x-auto border-b px-3.5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-4'
          style={{ backgroundColor: APP.surface, borderColor: APP.border }}
        >
          {[
            ['הכל · 248', true],
            ['חדש · 12', false],
            ['בטיפול · 61', false],
            ['מעוניין · 24', false],
          ].map(([label, active], i) => (
            <span
              key={String(label)}
              className={`shrink-0 rounded-md px-2 py-1 text-[11.5px] font-medium whitespace-nowrap ${i > 2 ? 'hidden sm:inline' : ''}`}
              style={
                active
                  ? { backgroundColor: APP.primarySoft, color: APP.primaryText }
                  : { backgroundColor: APP.bg, color: APP.muted }
              }
            >
              {label}
            </span>
          ))}
        </div>

        {/* Column headers */}
        <div
          className='hidden grid-cols-[1.7fr_0.9fr_1fr_0.9fr] gap-3 border-b px-4 py-2 text-[11px] font-medium sm:grid'
          style={{ borderColor: APP.border, color: APP.faint }}
        >
          <span>ליד</span>
          <span>סטטוס</span>
          <span>נציג</span>
          <span>מעקב הבא</span>
        </div>

        {/* Rows */}
        <div style={{ backgroundColor: APP.surface }}>
          {ROWS.map((r) => (
            <div
              key={r.name}
              className='grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[1.7fr_0.9fr_1fr_0.9fr] sm:gap-y-0 sm:px-4'
              style={{ borderColor: APP.border, backgroundColor: r.fresh ? APP.primarySoft : undefined }}
            >
              <div className='flex min-w-0 items-center gap-2.5'>
                <Initial name={r.name} />
                <span className='truncate font-medium'>{r.name}</span>
                <ChannelMark channel={r.channel} size={16} />
              </div>
              <StatusPill status={r.status} />
              <span className='hidden truncate sm:block' style={{ color: APP.muted }}>
                {r.owner}
              </span>
              <span
                className='col-span-2 truncate text-[11.5px] sm:col-span-1 sm:text-[12px]'
                style={{ color: r.urgent ? APP.primaryText : APP.faint }}
              >
                <span className='sm:hidden'>{r.owner} · </span>
                {r.next}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
