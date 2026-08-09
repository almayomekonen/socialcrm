import { useId } from 'react'
import Portrait from '@/components/settings/art/Portrait'

/** Card face, white → barely grey. */
const CARD = '#e6e9ef'
/** The dashed run between beats of the flow. */
const TRAIL = '#cdd3dc'
/** WhatsApp green, the same value the rest of the product uses. */
const GREEN = '#25D366'
const BUBBLE_STROKE = '#8fd6b0'
const BAR = '#e2e6ec'
const BAR_SOFT = '#eef0f4'
const TEXT_STRONG = '#5a6b80'
const TEXT_SOFT = '#8b98a8'

/**
 * The speech-bubble outline: a rounded rect whose tail drops from the bottom
 * left. Written as a function because three scenes draw it at three sizes and
 * the tail has to keep its exact proportions.
 */
function bubble(x: number, y: number, w: number, h: number, r = 12) {
  return (
    `M${x + w - r} ${y}H${x + r}a${r} ${r} 0 0 0-${r} ${r}` +
    `v${h - 2 * r}a${r} ${r} 0 0 0 ${r} ${r}h6v10l11-10h${w - 2 * r - 17}` +
    `a${r} ${r} 0 0 0 ${r}-${r}V${y + r}a${r} ${r} 0 0 0-${r}-${r}z`
  )
}

/** The leftward arrowhead that ends a dashed run. */
function Arrow({ x, y, angle }: { x: number; y: number; angle: number }) {
  return <path d={`M${x} ${y} l7 -4 l0 8 z`} fill='#c4cad3' transform={`rotate(${angle} ${x} ${y})`} />
}

/** The gradients and elevation both the ported and the new scenes draw with. */
function Defs({ uid }: { uid: string }) {
  return (
    <defs>
      <linearGradient id={`${uid}c`} x1='1' y1='0' x2='0' y2='1'>
        <stop offset='0' stopColor='#ffffff' />
        <stop offset='1' stopColor='#f7f8fb' />
      </linearGradient>
      <linearGradient id={`${uid}g`} x1='1' y1='0' x2='0' y2='1'>
        <stop offset='0' stopColor='#eafaf2' />
        <stop offset='1' stopColor='#d6f2e3' />
      </linearGradient>
      <linearGradient id={`${uid}v`} x1='1' y1='0' x2='0' y2='1'>
        <stop offset='0' stopColor='#6f79dd' />
        <stop offset='1' stopColor='#5058c4' />
      </linearGradient>
      <filter id={`${uid}e2`} x='-60%' y='-60%' width='220%' height='220%'>
        <feDropShadow dx='0' dy='6' stdDeviation='8' floodColor='#0a2540' floodOpacity='0.10' />
      </filter>
      <filter id={`${uid}e1`} x='-60%' y='-60%' width='220%' height='220%'>
        <feDropShadow dx='0' dy='3' stdDeviation='5' floodColor='#0a2540' floodOpacity='0.07' />
      </filter>
    </defs>
  )
}

/** Contact card: photo, name bar, and a status pill. */
function ContactCard({
  uid,
  x,
  y,
  status = 'online',
  warm = false,
}: {
  uid: string
  x: number
  y: number
  status?: 'online' | 'cold'
  warm?: boolean
}) {
  return (
    <>
      <g filter={`url(#${uid}e2)`}>
        <rect x={x} y={y} width='96' height='56' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
      </g>
      <Portrait cx={x + 78} cy={y + 20} r={10} uid={uid} warm={warm} />
      <rect x={x + 12} y={y + 14} width='48' height='6' rx='3' fill={BAR} />
      <rect x={x + 24} y={y + 26} width='36' height='5' rx='2.5' fill={BAR_SOFT} />
      <rect
        x={x + 12}
        y={y + 38}
        width='34'
        height='10'
        rx='5'
        fill={status === 'online' ? '#eff9f3' : '#fdece9'}
      />
      <circle cx={x + 19} cy={y + 43} r='2.5' fill={status === 'online' ? GREEN : '#df1b41'} />
    </>
  )
}

const SCENES: Record<string, (uid: string) => React.ReactNode> = {
  /*
   * רצף קבלת פנים — the contact arrives top right, the immediate message is
   * lit, and the later two recede down the dotted timeline.
   */
  welcome_sequence: (uid) => (
    <>
      <path d='M292 136H32' stroke='#e6e9ef' strokeDasharray='1 7' />
      <ContactCard uid={uid} x={300} y={24} />
      <path d='M348 84c0 16-32 4-56 4' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={284} y={88} angle={180} />

      <circle cx='232' cy='136' r='14' fill={GREEN} opacity='.12' />
      <g filter={`url(#${uid}e1)`}>
        <path d={bubble(188, 60, 88, 56)} fill={`url(#${uid}g)`} stroke={BUBBLE_STROKE} />
      </g>
      <rect x='200' y='76' width='60' height='6' rx='3' fill='#4fb887' opacity='.55' />
      <rect x='212' y='90' width='48' height='6' rx='3' fill='#4fb887' opacity='.3' />
      <path d='M232 120v8' stroke='#a8ddc3' strokeDasharray='2 4' />
      <circle cx='232' cy='136' r='5' fill={GREEN} />

      <g filter={`url(#${uid}e1)`}>
        <rect x='108' y='72' width='72' height='44' rx='12' fill='#fff' stroke={CARD} />
      </g>
      <rect x='118' y='84' width='44' height='6' rx='3' fill={BAR} />
      <rect x='128' y='96' width='34' height='5' rx='2.5' fill={BAR_SOFT} />
      <path d='M144 120v8' stroke={BAR} strokeDasharray='2 4' />
      <circle cx='144' cy='136' r='4.5' fill='#d3d8e0' />

      <rect x='24' y='82' width='64' height='34' rx='12' fill='#fff' stroke={BAR_SOFT} />
      <rect x='34' y='92' width='38' height='5' rx='2.5' fill={BAR_SOFT} />
      <rect x='42' y='102' width='30' height='5' rx='2.5' fill='#f4f6f9' />
      <path d='M56 120v8' stroke={BAR_SOFT} strokeDasharray='2 4' />
      <circle cx='56' cy='136' r='4.5' fill='#dfe3e9' />

      <text x='232' y='152' textAnchor='middle' fontSize='12' fontWeight='600' fill={TEXT_STRONG} direction='rtl'>
        מיד
      </text>
      <text x='144' y='152' textAnchor='middle' fontSize='12' fill={TEXT_SOFT} direction='rtl'>
        יום 2
      </text>
      <text x='56' y='152' textAnchor='middle' fontSize='12' fill={TEXT_SOFT} direction='rtl'>
        יום 7
      </text>
    </>
  ),

  /*
   * מעקב אחרי ליד מהאתר — a real browser with a form and a cursor on the
   * submit button; the lead card flies out and becomes a message.
   */
  website_lead_follow_up: (uid) => (
    <>
      <g filter={`url(#${uid}e2)`}>
        <rect x='252' y='24' width='144' height='88' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
      </g>
      <path d='M252 48h144' stroke={CARD} />
      <circle cx='264' cy='36' r='2.5' fill={BAR} />
      <circle cx='274' cy='36' r='2.5' fill={BAR} />
      <circle cx='284' cy='36' r='2.5' fill={BAR} />
      <rect x='296' y='31' width='92' height='10' rx='5' fill='#f1f3f7' />
      <rect x='268' y='60' width='112' height='10' rx='5' fill='#f1f3f7' />
      <rect x='300' y='76' width='80' height='10' rx='5' fill='#f1f3f7' />
      <rect x='320' y='92' width='60' height='16' rx='6' fill={`url(#${uid}v)`} />
      <rect x='336' y='97' width='28' height='6' rx='3' fill='#fff' opacity='.55' />
      <path d='M330 100l10 13 1.5-5.5 5.5-1.5z' fill='#fff' stroke='#08203a' />

      <g transform='rotate(-4 192 72)'>
        <g filter={`url(#${uid}e2)`}>
          <rect x='144' y='48' width='96' height='48' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
        </g>
        <Portrait cx={222} cy={66} r={9} uid={uid} />
        <rect x='156' y='60' width='46' height='6' rx='3' fill={BAR} />
        <rect x='166' y='72' width='36' height='5' rx='2.5' fill={BAR_SOFT} />
      </g>
      <path d='M250 62h-8M252 76h-6' stroke='#d3d8e0' />

      <path d='M144 86c-20 10-16 16-38 20' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={106} y={106} angle={160} />
      <circle cx='124' cy='100' r='13' fill='#5e6ad2' opacity='.12' />
      <path d='M124 92l2.4 5.6 5.6 2.4-5.6 2.4-2.4 5.6-2.4-5.6-5.6-2.4 5.6-2.4z' fill='#5e6ad2' />

      <circle cx='72' cy='122' r='30' fill={GREEN} opacity='.1' />
      <g filter={`url(#${uid}e1)`}>
        <path d={bubble(24, 98, 96, 48)} fill={`url(#${uid}g)`} stroke={BUBBLE_STROKE} />
      </g>
      <rect x='36' y='112' width='66' height='6' rx='3' fill='#4fb887' opacity='.55' />
      <rect x='52' y='124' width='50' height='6' rx='3' fill='#4fb887' opacity='.3' />
    </>
  ),

  /*
   * מעקב אחרי ליד שאבד — the contact has gone cold, a reminder waits on the
   * clock, and one message brings a reply back.
   */
  lost_lead_follow_up: (uid) => (
    <>
      <ContactCard uid={uid} x={300} y={24} status='cold' warm />
      <path d='M348 84c-4 14-40 6-62 10' stroke={TRAIL} strokeDasharray='3 5' />

      <circle cx='256' cy='100' r='30' fill='#5e6ad2' opacity='.07' />
      <g filter={`url(#${uid}e2)`}>
        <circle cx='256' cy='100' r='18' fill='#fff' stroke={CARD} />
      </g>
      <path d='M256 89v11l7 5' stroke='#5e6ad2' />
      <path d='M256 78c-22 0-30-14-48-14' stroke='#dfe3e9' strokeDasharray='3 5' />

      <g filter={`url(#${uid}e2)`}>
        <rect x='132' y='28' width='120' height='44' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
      </g>
      <circle cx='230' cy='50' r='12' fill='#fdf6ea' />
      <path
        d='M226 52c0-4.6.7-7 4-7s4 2.4 4 7M224.6 52h10.8M228.4 54.8a2 2 0 0 0 3.2 0'
        stroke='#c98a20'
      />
      <rect x='144' y='40' width='60' height='6' rx='3' fill={BAR} />
      <rect x='156' y='52' width='48' height='5' rx='2.5' fill={BAR_SOFT} />

      <path d='M238 106c-24 8-50 2-74 4' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={156} y={110} angle={170} />

      <circle cx='76' cy='98' r='32' fill={GREEN} opacity='.1' />
      <g filter={`url(#${uid}e1)`}>
        <path d={bubble(24, 76, 112, 44)} fill={`url(#${uid}g)`} stroke={BUBBLE_STROKE} />
      </g>
      <rect x='36' y='88' width='76' height='6' rx='3' fill='#4fb887' opacity='.55' />
      <rect x='52' y='100' width='60' height='6' rx='3' fill='#4fb887' opacity='.3' />

      <g filter={`url(#${uid}e1)`}>
        <rect x='24' y='134' width='64' height='22' rx='11' fill='#fff' stroke={CARD} />
      </g>
      <circle cx='78' cy='145' r='3.5' fill={GREEN} />
      <rect x='34' y='142' width='34' height='6' rx='3' fill={BAR_SOFT} />
    </>
  ),

  /*
   * תודה על פנייה מהטופס — the form is submitted, the submission is checked
   * off, and the thank-you goes straight out.
   */
  contact_form_thank_you: (uid) => (
    <>
      <g filter={`url(#${uid}e2)`}>
        <rect x='276' y='30' width='120' height='96' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
      </g>
      <rect x='292' y='46' width='56' height='6' rx='3' fill={BAR} />
      <rect x='292' y='62' width='88' height='12' rx='6' fill='#f1f3f7' />
      <rect x='292' y='80' width='88' height='12' rx='6' fill='#f1f3f7' />
      <rect x='320' y='100' width='60' height='16' rx='6' fill={`url(#${uid}v)`} />
      <rect x='336' y='105' width='28' height='6' rx='3' fill='#fff' opacity='.55' />

      <path d='M274 92c-18 6-16 14-36 16' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={236} y={110} angle={168} />

      <circle cx='210' cy='104' r='20' fill='#25D366' opacity='.1' />
      <g filter={`url(#${uid}e2)`}>
        <circle cx='210' cy='104' r='14' fill='#fff' stroke={CARD} />
      </g>
      <path d='M204 104l4.4 4.6 8-9' stroke='#1f9d57' strokeWidth='2.2' />

      <path d='M192 112c-16 8-26 4-42 6' stroke={TRAIL} strokeDasharray='3 5' />

      <circle cx='84' cy='96' r='32' fill={GREEN} opacity='.1' />
      <g filter={`url(#${uid}e1)`}>
        <path d={bubble(24, 70, 112, 48)} fill={`url(#${uid}g)`} stroke={BUBBLE_STROKE} />
      </g>
      <rect x='36' y='84' width='76' height='6' rx='3' fill='#4fb887' opacity='.55' />
      <rect x='52' y='96' width='60' height='6' rx='3' fill='#4fb887' opacity='.3' />
    </>
  ),

  /*
   * תזכורת לפני פגישה — a date on the calendar, the clock counting down to
   * it, and the reminder landing before the meeting.
   */
  appointment_reminder: (uid) => (
    <>
      <g filter={`url(#${uid}e2)`}>
        <rect x='288' y='28' width='108' height='92' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
      </g>
      <path d='M288 52h108' stroke={CARD} />
      <rect x='300' y='36' width='40' height='6' rx='3' fill={BAR} />
      <circle cx='378' cy='39' r='2.5' fill={BAR} />
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2, 3].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={300 + col * 22}
            y={62 + row * 18}
            width='14'
            height='10'
            rx='3'
            fill={row === 1 && col === 2 ? '#5e6ad2' : '#f1f3f7'}
          />
        )),
      )}

      <path d='M286 92c-14 10-16 8-30 10' stroke={TRAIL} strokeDasharray='3 5' />

      <circle cx='226' cy='104' r='30' fill='#5e6ad2' opacity='.07' />
      <g filter={`url(#${uid}e2)`}>
        <circle cx='226' cy='104' r='18' fill='#fff' stroke={CARD} />
      </g>
      <path d='M226 93v11l7 5' stroke='#5e6ad2' />

      <g filter={`url(#${uid}e2)`}>
        <rect x='108' y='30' width='120' height='44' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
      </g>
      <circle cx='206' cy='52' r='12' fill='#fdf6ea' />
      <path
        d='M202 54c0-4.6.7-7 4-7s4 2.4 4 7M200.6 54h10.8M204.4 56.8a2 2 0 0 0 3.2 0'
        stroke='#c98a20'
      />
      <rect x='120' y='42' width='60' height='6' rx='3' fill={BAR} />
      <rect x='132' y='54' width='48' height='5' rx='2.5' fill={BAR_SOFT} />
      <path d='M226 82c-8 14-40 4-58 4' stroke={TRAIL} strokeDasharray='3 5' />

      <path d='M208 110c-22 8-44 2-62 4' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={138} y={114} angle={170} />

      <circle cx='72' cy='106' r='30' fill={GREEN} opacity='.1' />
      <g filter={`url(#${uid}e1)`}>
        <path d={bubble(24, 84, 96, 48)} fill={`url(#${uid}g)`} stroke={BUBBLE_STROKE} />
      </g>
      <rect x='36' y='98' width='66' height='6' rx='3' fill='#4fb887' opacity='.55' />
      <rect x='52' y='110' width='50' height='6' rx='3' fill='#4fb887' opacity='.3' />
    </>
  ),

  /*
   * משימה לנציג — a new lead lands and the rep gets a task with their name
   * on it. The only scene that ends inside the product rather than in a chat.
   */
  internal_task_on_new_lead: (uid) => (
    <>
      <ContactCard uid={uid} x={300} y={28} />
      <path d='M348 88c-2 16-34 6-58 8' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={284} y={98} angle={176} />

      <circle cx='166' cy='92' r='34' fill='#5e6ad2' opacity='.07' />
      <g filter={`url(#${uid}e2)`}>
        <rect x='96' y='52' width='152' height='80' rx='12' fill={`url(#${uid}c)`} stroke={CARD} />
      </g>
      <rect x='112' y='66' width='58' height='6' rx='3' fill={BAR} />
      {[0, 1, 2].map((row) => {
        const y = 84 + row * 16
        const done = row === 0
        return (
          <g key={row}>
            <rect
              x='112'
              y={y}
              width='11'
              height='11'
              rx='3'
              fill={done ? '#5e6ad2' : '#fff'}
              stroke={done ? '#5e6ad2' : '#d9dee6'}
            />
            {done && <path d={`M114.6 ${y + 5.6}l2.2 2.2 4-4.4`} stroke='#fff' strokeWidth='1.6' />}
            <rect x='130' y={y + 3} width={row === 2 ? 60 : 92} height='5' rx='2.5' fill={BAR_SOFT} />
          </g>
        )
      })}
      <Portrait cx={226} cy={70} r={10} uid={uid} warm />

      <path d='M94 104c-12 8-22 6-32 8' stroke={TRAIL} strokeDasharray='3 5' />

      <g filter={`url(#${uid}e1)`}>
        <rect x='24' y='100' width='64' height='22' rx='11' fill='#fff' stroke={CARD} />
      </g>
      <circle cx='78' cy='111' r='3.5' fill='#5e6ad2' />
      <rect x='34' y='108' width='34' height='6' rx='3' fill={BAR_SOFT} />
    </>
  ),
}

/** Drawn when a template registers a key no scene has been designed for. */
function fallback(uid: string) {
  return (
    <>
      <ContactCard uid={uid} x={300} y={40} />
      <path d='M348 100c-6 16-40 6-64 8' stroke={TRAIL} strokeDasharray='3 5' />
      <Arrow x={276} y={108} angle={176} />
      <circle cx='90' cy='104' r='32' fill={GREEN} opacity='.1' />
      <g filter={`url(#${uid}e1)`}>
        <path d={bubble(24, 80, 120, 48)} fill={`url(#${uid}g)`} stroke={BUBBLE_STROKE} />
      </g>
      <rect x='36' y='94' width='84' height='6' rx='3' fill='#4fb887' opacity='.55' />
      <rect x='52' y='106' width='68' height='6' rx='3' fill='#4fb887' opacity='.3' />
    </>
  )
}

export default function TemplateArt({ templateKey }: { templateKey: string }) {
  const uid = useId().replace(/:/g, '')
  const scene = SCENES[templateKey] ?? fallback
  return (
    <svg
      viewBox='0 0 420 180'
      fill='none'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      /* Capped at its drawn size, so on desktop this is exactly 420×180 and on
         a narrow card the scene scales down rather than being cropped by the
         well's overflow. */
      className='h-auto w-full max-w-105'
    >
      <Defs uid={uid} />
      {scene(uid)}
    </svg>
  )
}
