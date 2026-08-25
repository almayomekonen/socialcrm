import { APP, ChannelMark, StatusPill, type LeadStatus } from './chrome'

/**
 * The operational-control surface: which leads need attention today, and why.
 *
 * WHAT THIS IS AND IS NOT. Everything here is derived from data the product
 * already holds — a follow-up date, a status timestamp, an SLA window. The SLA
 * figures are the real ones from `lib/today/constants.ts`:
 * `SLA_HOURS_BY_STATUS = { contacted: 24, interested: 72 }`.
 *
 * It is NOT the Customer Automation Engine. That engine is allowlist-gated,
 * off by default and log-only (`lib/automations/flags.ts`), so it is not
 * marketed anywhere on this site. Resurfacing a lead whose follow-up date has
 * arrived is a query, not a background agent, and it is described as such.
 */

type Item = { name: string; channel: 'whatsapp' | 'facebook' | 'instagram'; status: LeadStatus; why: string; urgent?: boolean }

const ITEMS: Item[] = [
  { name: 'דני לוי', channel: 'whatsapp', status: 'contacted', why: 'מחכה לתשובה מעל 24 שעות', urgent: true },
  { name: 'אבי שרון', channel: 'facebook', status: 'interested', why: 'הצעה נשלחה, בלי מגע 72 שעות', urgent: true },
  { name: 'מיכל אברהם', channel: 'instagram', status: 'contacted', why: 'נקבע מעקב להיום' },
  { name: 'שרה פרץ', channel: 'whatsapp', status: 'contacted', why: 'ביקשה שיחזרו אליה מחר' },
]

export function FollowUpQueue() {
  return (
    <div dir='rtl' className='text-[13px]' style={{ backgroundColor: APP.bg, color: APP.ink }}>
      <div
        className='flex items-baseline justify-between gap-3 border-b px-4 py-3'
        style={{ backgroundColor: APP.surface, borderColor: APP.border }}
      >
        <p className='font-semibold'>מה מחכה לך היום</p>
        <p className='text-[11.5px]' style={{ color: APP.faint }}>
          4 לידים
        </p>
      </div>

      <ul style={{ backgroundColor: APP.surface }}>
        {ITEMS.map((it) => (
          <li
            key={it.name}
            className='flex items-start gap-3 border-b px-4 py-3 last:border-b-0'
            style={{ borderColor: APP.border }}
          >
            <span className='mt-0.5'>
              <ChannelMark channel={it.channel} size={18} />
            </span>
            <div className='min-w-0 flex-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-medium'>{it.name}</span>
                <StatusPill status={it.status} />
              </div>
              <p className='mt-1 text-[12px]' style={{ color: it.urgent ? APP.primaryText : APP.faint }}>
                {it.why}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
