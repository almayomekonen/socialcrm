// Decorative trend line for a KPI card (RSC). Null points are gaps (no data that
// day), never zeros. Hidden from assistive tech: the card states the value.
const W = 96
const H = 36

export default function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const known = values.filter((v): v is number => v != null)
  if (known.length < 2) return null
  const max = Math.max(...known)
  const min = Math.min(...known)
  const x = (i: number) => (values.length === 1 ? 0 : (i * W) / (values.length - 1))
  const y = (v: number) => 4 + (H - 8) * (1 - (v - min) / (max - min || 1))

  let line = ''
  let pen = false
  values.forEach((v, i) => {
    if (v == null) return void (pen = false)
    line += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `
    pen = true
  })
  const firstIdx = values.findIndex((v) => v != null)
  const lastIdx = values.length - 1 - [...values].reverse().findIndex((v) => v != null)
  const area = `${line}L${x(lastIdx).toFixed(1)} ${H} L${x(firstIdx).toFixed(1)} ${H} Z`

  return (
    <svg aria-hidden width={W} height={H} viewBox={`0 0 ${W} ${H}`} className='shrink-0 overflow-visible' style={{ direction: 'ltr' }}>
      <path d={area} style={{ fill: color, opacity: 0.12 }} />
      <path d={line} fill='none' style={{ stroke: color }} strokeWidth={2} strokeLinejoin='round' strokeLinecap='round' />
    </svg>
  )
}
