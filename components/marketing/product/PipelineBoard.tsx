import { APP, ChannelMark, STATUS, type LeadStatus } from './chrome'

/**
 * The pipeline, in the product's REAL status vocabulary
 * (`lib/leads/statusStyles.ts`): חדש → בטיפול → מעוניין → סגור, with אבוד as
 * the exit. No invented stage names.
 *
 * A closed ליד stays a ליד — the product has one entity and "client" is a
 * status, not a separate record (CLAUDE.md, Entity Constraint).
 *
 * Mobile: two columns rather than four, so cards keep their type size.
 */

const COLUMNS: { key: LeadStatus; cards: { name: string; channel: 'whatsapp' | 'facebook' | 'instagram'; meta: string }[] }[] = [
  {
    key: 'new',
    cards: [
      { name: 'דני לוי', channel: 'whatsapp', meta: 'נכנס לפני 4 דק׳' },
      { name: 'לירון כץ', channel: 'instagram', meta: 'ממודעה' },
    ],
  },
  {
    key: 'contacted',
    cards: [
      { name: 'מיכל אברהם', channel: 'instagram', meta: 'מעקב מחר' },
      { name: 'שרה פרץ', channel: 'whatsapp', meta: 'מעקב 18/9' },
    ],
  },
  {
    key: 'interested',
    cards: [{ name: 'אבי שרון', channel: 'facebook', meta: 'הצעה נשלחה' }],
  },
  {
    key: 'closed',
    cards: [{ name: 'נועם ביטון', channel: 'facebook', meta: 'נסגר החודש' }],
  },
]

export function PipelineBoard() {
  return (
    <div
      dir='rtl'
      className='grid grid-cols-2 gap-2.5 p-3 text-[13px] lg:grid-cols-4'
      style={{ backgroundColor: APP.bg, color: APP.ink }}
    >
      {COLUMNS.map((c) => {
        const s = STATUS[c.key]
        return (
          <div key={c.key} className='flex flex-col gap-2'>
            <div className='flex items-center gap-2 px-1'>
              <span aria-hidden='true' className='size-2 shrink-0 rounded-full' style={{ backgroundColor: s.dot }} />
              <span className='text-[12px] font-semibold'>{s.label}</span>
              <span className='text-[11.5px]' style={{ color: APP.faint }}>
                {c.cards.length}
              </span>
            </div>
            {c.cards.map((card) => (
              <div
                key={card.name}
                className='rounded-md border p-2.5'
                style={{ backgroundColor: APP.surface, borderColor: APP.border }}
              >
                <div className='flex items-center gap-2'>
                  <ChannelMark channel={card.channel} size={15} />
                  <span className='truncate text-[12.5px] font-medium'>{card.name}</span>
                </div>
                <p className='mt-1.5 text-[11.5px]' style={{ color: APP.faint }}>
                  {card.meta}
                </p>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
