import Portrait from '@/components/settings/art/Portrait'

/**
 * The shared vocabulary of the template-gallery illustrations: palette, the
 * speech-bubble path, the arrowhead, the filters and the contact card.
 *
 * Split out of TemplateArt, which had crossed the file-size hard limit
 * (architecture-rules §1). Drawing unchanged.
 */
/** Card face, white → barely grey. */
export const CARD = '#e6e9ef'
/** The dashed run between beats of the flow. */
export const TRAIL = '#cdd3dc'
/** WhatsApp green, the same value the rest of the product uses. */
export const GREEN = '#25D366'
export const BUBBLE_STROKE = '#8fd6b0'
export const BAR = '#e2e6ec'
export const BAR_SOFT = '#eef0f4'
export const TEXT_STRONG = '#5a6b80'
export const TEXT_SOFT = '#8b98a8'

/**
 * The speech-bubble outline: a rounded rect whose tail drops from the bottom
 * left. Written as a function because three scenes draw it at three sizes and
 * the tail has to keep its exact proportions.
 */
export function bubble(x: number, y: number, w: number, h: number, r = 12) {
  return (
    `M${x + w - r} ${y}H${x + r}a${r} ${r} 0 0 0-${r} ${r}` +
    `v${h - 2 * r}a${r} ${r} 0 0 0 ${r} ${r}h6v10l11-10h${w - 2 * r - 17}` +
    `a${r} ${r} 0 0 0 ${r}-${r}V${y + r}a${r} ${r} 0 0 0-${r}-${r}z`
  )
}

/** The leftward arrowhead that ends a dashed run. */
export function Arrow({ x, y, angle }: { x: number; y: number; angle: number }) {
  return <path d={`M${x} ${y} l7 -4 l0 8 z`} fill='#c4cad3' transform={`rotate(${angle} ${x} ${y})`} />
}

/** The gradients and elevation both the ported and the new scenes draw with. */
export function Defs({ uid }: { uid: string }) {
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
export function ContactCard({
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

