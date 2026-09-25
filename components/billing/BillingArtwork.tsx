/**
 * Decorative artwork for the card-setup panel.
 *
 * Original SVG, no stock imagery. It suggests what the product actually does —
 * scattered conversations drawn together into one ordered column — without
 * illustrating it literally or competing with the form for attention.
 *
 * Deliberately restrained: two indigo tints from the app's own tokens, one soft
 * light source, hairline connectors. No gradients stacked on gradients, no
 * glass, no neon. It is `aria-hidden` because it says nothing a screen reader
 * needs; the panel's real meaning is in the text beside it.
 *
 * Motion is a single slow drift on three nodes, and it is removed entirely
 * under prefers-reduced-motion (see .billing-art-drift in lib/css/main.css).
 */
export default function BillingArtwork({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 440 560'
      role='presentation'
      aria-hidden='true'
      focusable='false'
      className={className}
      preserveAspectRatio='xMidYMid slice'
    >
      <defs>
        {/* One light source, upper-left, falling across the panel. */}
        <radialGradient id='ba-glow' cx='28%' cy='18%' r='82%'>
          <stop offset='0%' stopColor='#ffffff' stopOpacity='0.95' />
          <stop offset='52%' stopColor='#eeeffb' stopOpacity='0.55' />
          <stop offset='100%' stopColor='#e6e8f7' stopOpacity='0' />
        </radialGradient>
        <linearGradient id='ba-card' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stopColor='#ffffff' stopOpacity='0.96' />
          <stop offset='100%' stopColor='#ffffff' stopOpacity='0.82' />
        </linearGradient>
        <linearGradient id='ba-accent' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stopColor='#5e6ad2' />
          <stop offset='100%' stopColor='#8b91f0' />
        </linearGradient>
        <filter id='ba-soft' x='-40%' y='-40%' width='180%' height='180%'>
          <feDropShadow dx='0' dy='10' stdDeviation='14' floodColor='#0a2540' floodOpacity='0.10' />
        </filter>
        <filter id='ba-tight' x='-40%' y='-40%' width='180%' height='180%'>
          <feDropShadow dx='0' dy='4' stdDeviation='6' floodColor='#0a2540' floodOpacity='0.10' />
        </filter>
      </defs>

      <rect width='440' height='560' fill='url(#ba-glow)' />

      {/* A faint grid, far back — structure without a pattern you notice. */}
      <g stroke='#5e6ad2' strokeOpacity='0.07' strokeWidth='1'>
        {[80, 160, 240, 320, 400].map((x) => (
          <line key={`v${x}`} x1={x} y1='0' x2={x} y2='560' />
        ))}
        {[90, 190, 290, 390, 490].map((y) => (
          <line key={`h${y}`} x1='0' y1={y} x2='440' y2={y} />
        ))}
      </g>

      {/* Connectors: scattered sources converging on the ordered column. */}
      <g stroke='url(#ba-accent)' strokeOpacity='0.32' strokeWidth='1.5' fill='none' strokeLinecap='round'>
        <path d='M96 120 C 170 130, 196 176, 244 196' />
        <path d='M72 252 C 158 250, 182 268, 244 274' />
        <path d='M104 388 C 176 380, 200 360, 244 352' />
        <path d='M120 470 C 190 452, 214 424, 244 404' />
      </g>

      {/* The scattered side: loose conversation marks. */}
      <g className='billing-art-drift'>
        <g filter='url(#ba-tight)'>
          <rect x='40' y='92' width='104' height='56' rx='16' fill='url(#ba-card)' />
          <rect x='58' y='112' width='58' height='7' rx='3.5' fill='#0a2540' fillOpacity='0.24' />
          <rect x='58' y='127' width='38' height='7' rx='3.5' fill='#0a2540' fillOpacity='0.14' />
        </g>
        <g filter='url(#ba-tight)'>
          <rect x='22' y='224' width='96' height='52' rx='16' fill='url(#ba-card)' />
          <rect x='40' y='242' width='52' height='7' rx='3.5' fill='#0a2540' fillOpacity='0.22' />
          <rect x='40' y='256' width='32' height='7' rx='3.5' fill='#0a2540' fillOpacity='0.13' />
        </g>
        <g filter='url(#ba-tight)'>
          <rect x='52' y='360' width='100' height='54' rx='16' fill='url(#ba-card)' />
          <rect x='70' y='379' width='56' height='7' rx='3.5' fill='#0a2540' fillOpacity='0.22' />
          <rect x='70' y='393' width='34' height='7' rx='3.5' fill='#0a2540' fillOpacity='0.13' />
        </g>
      </g>

      {/* The ordered column: the same conversations, in one list. */}
      <g filter='url(#ba-soft)'>
        <rect x='244' y='150' width='164' height='268' rx='22' fill='url(#ba-card)' />
        <rect x='244' y='150' width='164' height='268' rx='22' fill='none' stroke='#5e6ad2' strokeOpacity='0.16' />
        {[0, 1, 2, 3].map((i) => {
          const y = 182 + i * 62
          return (
            <g key={i}>
              <circle cx='274' cy={y + 14} r='11' fill='#eeeffb' />
              <circle cx='274' cy={y + 14} r='11' fill='none' stroke='#5e6ad2' strokeOpacity='0.28' />
              <rect x='294' y={y + 6} width={i === 1 ? 82 : 66} height='7' rx='3.5' fill='#0a2540' fillOpacity='0.26' />
              <rect x='294' y={y + 20} width={i === 2 ? 52 : 40} height='7' rx='3.5' fill='#0a2540' fillOpacity='0.13' />
            </g>
          )
        })}
        {/* One row marked as handled — the quiet payoff of the whole picture. */}
        <rect x='258' y='358' width='136' height='2' rx='1' fill='#5e6ad2' fillOpacity='0.12' />
        <circle cx='274' cy='386' r='11' fill='url(#ba-accent)' fillOpacity='0.9' />
        <path d='M269.5 386.5 l3.2 3.2 l6-6.4' fill='none' stroke='#ffffff' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
        <rect x='294' y='382' width='58' height='7' rx='3.5' fill='#0a2540' fillOpacity='0.2' />
      </g>
    </svg>
  )
}
