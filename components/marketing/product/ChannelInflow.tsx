import { APP, ChannelMark, StatusPill } from './chrome'

/**
 * The problem and its resolution, as two views of the same four arrivals.
 *
 * Framed as the reality the reader already lives in, never as an accusation.
 * `care-charter.md` Law 13 and `brand-principles.md` §4.2 both forbid reporting
 * the user's own neglect back to them, so nothing counts what they missed — it
 * shows where things land.
 */

const INBOX: { channel: 'whatsapp' | 'facebook' | 'instagram'; who: string; text: string; when: string; where: string }[] = [
  { channel: 'whatsapp', who: 'דני לוי', text: 'היי, אפשר לקבל פרטים?', when: 'לפני 4 דק׳', where: 'וואטסאפ' },
  { channel: 'instagram', who: 'מיכל אברהם', text: 'כמה זה עולה?', when: 'לפני שעה', where: 'הודעה באינסטגרם' },
  { channel: 'facebook', who: 'אבי שרון', text: 'מילא טופס — מבקש הצעה', when: 'אתמול', where: 'טופס בפייסבוק' },
  { channel: 'whatsapp', who: 'שרה פרץ', text: 'אפשר לחזור אליי מחר?', when: 'לפני יומיים', where: 'וואטסאפ' },
]

/** Before: four arrivals, three places, and no shared state between them. */
export function ScatteredInflow() {
  return (
    <ul className='flex flex-col gap-2.5' dir='rtl'>
      {INBOX.map((m, i) => (
        <li
          key={m.who}
          className='flex items-center gap-3 rounded-mkt-lg border border-mkt-border bg-mkt-surface p-3.5'
          // Each later arrival drifts a little further out of view.
          style={{ marginInlineStart: `${i * 12}px`, opacity: 1 - i * 0.13 }}
        >
          <ChannelMark channel={m.channel} size={24} />
          <div className='min-w-0 flex-1'>
            <p className='truncate text-[0.9375rem] font-medium text-mkt-fg'>{m.who}</p>
            <p className='truncate mkt-caption text-mkt-muted'>{m.text}</p>
          </div>
          <span className='shrink-0 mkt-caption text-mkt-faint'>{m.when}</span>
        </li>
      ))}
      <li
        className='rounded-mkt-lg border border-dashed border-mkt-border px-3.5 py-3 text-center mkt-caption text-mkt-faint'
        style={{ marginInlineStart: `${4 * 12}px` }}
      >
        ועוד, בשלושה מקומות שונים
      </li>
    </ul>
  )
}

/** After: the same four, in one list, each with a status and an owner. */
export function UnifiedInflow() {
  return (
    <div dir='rtl' className='overflow-hidden text-[13px]' style={{ backgroundColor: APP.surface, color: APP.ink }}>
      {INBOX.map((m, i) => (
        <div
          key={m.who}
          className='flex items-center gap-3 border-b px-4 py-3 last:border-b-0'
          style={{ borderColor: APP.border }}
        >
          <ChannelMark channel={m.channel} size={20} />
          <div className='min-w-0 flex-1'>
            <p className='truncate font-medium'>{m.who}</p>
            <p className='truncate text-[11.5px]' style={{ color: APP.faint }}>
              {m.where}
            </p>
          </div>
          <StatusPill status={i === 0 ? 'new' : 'contacted'} />
        </div>
      ))}
    </div>
  )
}
