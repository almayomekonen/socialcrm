import { AppWindow, StatusPill, ChannelMark, Initial, APP, type LeadStatus } from './chrome'

/**
 * The leads workspace — the hero's focal product visual.
 *
 * MOBILE REFLOWS, IT DOES NOT SHRINK. Below `sm` the table drops to two
 * columns and each row stacks its owner and follow-up into a secondary line, so
 * nothing renders below 11px. Lumen's answer to the same problem is a scaled
 * desktop capture that becomes illegible at 390px; this is the rule that
 * replaces it.
 */

type Row = {
  name: string
  channel: 'whatsapp' | 'facebook' | 'instagram'
  status: LeadStatus
  owner: string
  next: string
  urgent?: boolean
  /** The row that just arrived. */
  fresh?: boolean
}

const ROWS: Row[] = [
  { name: 'דני לוי', channel: 'whatsapp', status: 'new', owner: 'יוסי כהן', next: 'היום, 14:00', urgent: true, fresh: true },
  { name: 'מיכל אברהם', channel: 'instagram', status: 'contacted', owner: 'רחל גולן', next: 'מחר' },
  { name: 'אבי שרון', channel: 'facebook', status: 'interested', owner: 'יוסי כהן', next: 'יום ג׳' },
  { name: 'שרה פרץ', channel: 'whatsapp', status: 'contacted', owner: 'רחל גולן', next: '18 בספט׳' },
  { name: 'נועם ביטון', channel: 'facebook', status: 'closed', owner: 'יוסי כהן', next: '—' },
  { name: 'לירון כץ', channel: 'instagram', status: 'new', owner: 'לא שויך', next: 'היום' },
]

function Chip({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span
      className='shrink-0 rounded-md px-2 py-1 text-[11.5px] font-medium whitespace-nowrap'
      style={active ? { backgroundColor: APP.primarySoft, color: APP.primaryText } : { backgroundColor: APP.bg, color: APP.muted }}
    >
      {children}
    </span>
  )
}

export function LeadsWorkspace() {
  return (
    <AppWindow
      title='הלידים שלי'
      toolbar={
        <span
          className='hidden shrink-0 rounded-md px-2.5 py-1 text-[11.5px] font-semibold text-white sm:inline'
          style={{ backgroundColor: APP.primary }}
        >
          הוסף ליד
        </span>
      }
    >
      <div
        className='flex items-center gap-1.5 overflow-hidden border-b px-3.5 py-2 sm:px-4'
        style={{ backgroundColor: APP.surface, borderColor: APP.border }}
      >
        <Chip active>הכל · 248</Chip>
        <Chip>חדש · 12</Chip>
        <Chip>בטיפול · 61</Chip>
        <span className='hidden sm:contents'>
          <Chip>מעוניין · 24</Chip>
        </span>
      </div>

      {/* Column headers — desktop only; on mobile the rows label themselves. */}
      <div
        className='hidden grid-cols-[1.7fr_0.9fr_1fr_0.9fr] gap-3 border-b px-4 py-2 text-[11px] font-medium sm:grid'
        style={{ borderColor: APP.border, color: APP.faint }}
      >
        <span>ליד</span>
        <span>סטטוס</span>
        <span>נציג</span>
        <span>מעקב הבא</span>
      </div>

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

            {/* Mobile: owner + follow-up share one secondary line. */}
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
    </AppWindow>
  )
}
