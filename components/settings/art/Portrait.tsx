/**
 * The illustrated person used everywhere the settings artwork needs a face —
 * the contact cards in the automation template scenes and the business profile
 * hero. One copy so the two pages cannot drift apart.
 *
 * Every measurement is a fraction of `r`, because the same drawing has to hold
 * up at the 9px circles inside a template scene and at the 22px avatar on the
 * profile card. Detail that survives that range is worth adding; detail that
 * turns to mush below 10px is not, which is why there is no iris, no nostril
 * and no individual eyelash here.
 *
 * Light comes from the top right, matching every gradient in this artwork
 * (`x1=1 → x2=0`), so the modelling on the face and shirt runs the same way.
 *
 * Takes `uid` rather than calling `useId`, so it stays usable from server
 * components as well as client ones.
 */
export default function Portrait({
  cx,
  cy,
  r,
  uid,
  warm = false,
}: {
  cx: number
  cy: number
  r: number
  /** Namespace for the gradient ids. Must be unique per rendered SVG. */
  uid: string
  /** A second person: warmer backdrop, darker skin, hair down to the jaw. */
  warm?: boolean
}) {
  const key = `${uid}-p${warm ? 'w' : ''}${Math.round(cx)}x${Math.round(cy)}`
  const clip = `${key}c`
  const sky = `${key}b`
  const skin = `${key}s`
  const shirt = `${key}t`

  /** Head centre and radii — an egg rather than a ball, so it reads as a head. */
  const hy = cy - r * 0.15
  const hrx = r * 0.4
  const hry = r * 0.45

  return (
    <>
      <defs>
        <clipPath id={clip}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
        <linearGradient id={sky} x1='1' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor={warm ? '#f1e4d9' : '#e9eef6'} />
          <stop offset='1' stopColor={warm ? '#dfcbba' : '#d6dfeb'} />
        </linearGradient>
        {/* Off-centre so the cheek catches the light and the far side falls away. */}
        <radialGradient id={skin} cx='66%' cy='30%' r='78%'>
          <stop offset='0' stopColor={warm ? '#e7b48a' : '#f2caa6'} />
          <stop offset='1' stopColor={warm ? '#c98f63' : '#dfa276'} />
        </radialGradient>
        <linearGradient id={shirt} x1='1' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor={warm ? '#8b9ab0' : '#98a2b5'} />
          <stop offset='1' stopColor={warm ? '#6f7d93' : '#7c869b'} />
        </linearGradient>
      </defs>

      <g clipPath={`url(#${clip})`}>
        <circle cx={cx} cy={cy} r={r} fill={`url(#${sky})`} />

        {/* Painted back to front. The neck goes in before the shirt, or its
            edges cut a visible box across the shoulders. */}
        <path
          d={`M${cx - r * 0.15} ${cy + r * 0.02}L${cx + r * 0.15} ${cy + r * 0.02}L${cx + r * 0.22} ${cy + r * 0.62}L${cx - r * 0.22} ${cy + r * 0.62}z`}
          fill={warm ? '#bd8459' : '#d69b6d'}
        />
        {/* Chin throws a shadow down the neck. */}
        <ellipse cx={cx} cy={cy + r * 0.13} rx={r * 0.16} ry={r * 0.08} fill='#a8703f' opacity='.3' />
        <ellipse cx={cx} cy={cy + r * 1.04} rx={r * 0.86} ry={r * 0.64} fill={`url(#${shirt})`} />
        {/* An open collar: the V is the chest showing through, with the shirt
            edge picked out either side. More than anything else here, this is
            what stops the figure reading as a bust on a plinth. */}
        <path
          d={`M${cx - r * 0.24} ${cy + r * 0.42}L${cx} ${cy + r * 0.74}L${cx + r * 0.24} ${cy + r * 0.42}z`}
          fill={warm ? '#c98f63' : '#dfa276'}
        />
        <path
          d={`M${cx - r * 0.28} ${cy + r * 0.4}L${cx} ${cy + r * 0.76}L${cx + r * 0.28} ${cy + r * 0.4}`}
          stroke={warm ? '#a4b1c4' : '#b0b9c9'}
          strokeWidth={r * 0.07}
          fill='none'
        />

        {/* The second person wears their hair down. It goes in before the head
            so it falls behind the face instead of over it. */}
        {warm && (
          <path
            d={
              `M${cx} ${hy - r * 0.5}` +
              `C${cx + r * 0.5} ${hy - r * 0.5} ${cx + r * 0.52} ${hy + r * 0.1} ${cx + r * 0.44} ${hy + r * 0.52}` +
              `L${cx + r * 0.29} ${hy + r * 0.52}` +
              `C${cx + r * 0.38} ${hy + r * 0.1} ${cx + r * 0.34} ${hy - r * 0.18} ${cx} ${hy - r * 0.18}` +
              `C${cx - r * 0.34} ${hy - r * 0.18} ${cx - r * 0.38} ${hy + r * 0.1} ${cx - r * 0.29} ${hy + r * 0.52}` +
              `L${cx - r * 0.44} ${hy + r * 0.52}` +
              `C${cx - r * 0.52} ${hy + r * 0.1} ${cx - r * 0.5} ${hy - r * 0.5} ${cx} ${hy - r * 0.5}z`
            }
            fill='#5b4038'
          />
        )}

        <ellipse cx={cx} cy={hy} rx={hrx} ry={hry} fill={`url(#${skin})`} />
        <circle cx={cx - hrx} cy={hy + r * 0.04} r={r * 0.075} fill={warm ? '#c98f63' : '#dfa276'} />
        <circle cx={cx + hrx} cy={hy + r * 0.04} r={r * 0.075} fill={warm ? '#c98f63' : '#dfa276'} />

        {/* Crown, then a fringe swept to one side — the asymmetry is what stops
            it looking like a helmet at this size. It sits a shade proud of the
            head so no rim of scalp shows along the top. */}
        <path
          d={
            `M${cx - r * 0.44} ${hy + r * 0.06}` +
            `a${r * 0.44} ${r * 0.5} 0 0 1 ${r * 0.88} 0` +
            `c${-r * 0.03} ${-r * 0.18} ${-r * 0.12} ${-r * 0.3} ${-r * 0.26} ${-r * 0.34}` +
            `c${-r * 0.16} ${r * 0.12} ${-r * 0.36} ${r * 0.15} ${-r * 0.54} ${r * 0.1}` +
            `c${-r * 0.05} ${r * 0.06} ${-r * 0.08} ${r * 0.14} ${-r * 0.08} ${r * 0.24}z`
          }
          fill={warm ? '#5b4038' : '#4a3b34'}
        />

        <ellipse cx={cx - r * 0.15} cy={hy - r * 0.03} rx={r * 0.048} ry={r * 0.055} fill='#4b423c' />
        <ellipse cx={cx + r * 0.15} cy={hy - r * 0.03} rx={r * 0.048} ry={r * 0.055} fill='#4b423c' />
        <path
          d={`M${cx - r * 0.22} ${hy - r * 0.14}q${r * 0.07} -${r * 0.05} ${r * 0.14} 0M${cx + r * 0.08} ${hy - r * 0.14}q${r * 0.07} -${r * 0.05} ${r * 0.14} 0`}
          stroke={warm ? '#5b4038' : '#4a3b34'}
          strokeWidth={r * 0.045}
          opacity='.55'
          fill='none'
        />
        <path
          d={`M${cx - r * 0.09} ${hy + r * 0.19}q${r * 0.09} ${r * 0.07} ${r * 0.18} 0`}
          stroke='#b06f48'
          strokeWidth={r * 0.045}
          opacity='.6'
          fill='none'
        />
      </g>
      <circle cx={cx} cy={cy} r={r} fill='none' stroke='rgba(16,24,64,.10)' strokeWidth='0.8' />
    </>
  )
}
