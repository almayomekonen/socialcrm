'use client'

import { useState } from 'react'

// New leads (bars) vs leads that got a human reply (line), one column per
// business day. Time runs left → right regardless of page direction. Labels are
// precomputed on the server; this component only handles hover / keyboard focus.
export type TrendPoint = { newLeads: number; replied: number; short: string; long: string }

const VB_W = 720
const VB_H = 240
const X0 = 40
const X1 = 716
const Y0 = 220
const Y1 = 14

/** Axis top: four equal round-integer steps, the smallest that fits the data. */
function niceMax(raw: number): number {
  const target = Math.max(1, raw) / 4
  const steps = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 75]
  for (let mag = 1; ; mag *= 100) for (const s of steps) if (s * mag >= target) return s * mag * 4
}

export default function LeadsTrendChart({ points, showReplied = true }: { points: TrendPoint[]; showReplied?: boolean }) {
  const [active, setActive] = useState<number | null>(null)
  const n = points.length
  const max = niceMax(Math.max(...points.map((p) => Math.max(p.newLeads, showReplied ? p.replied : 0))))
  const step = (X1 - X0) / n
  const bw = Math.min(26, step * 0.6)
  const cx = (i: number) => X0 + step * i + step / 2
  const y = (v: number) => Y0 - ((Y0 - Y1) * v) / max
  const every = n > 20 ? 5 : n > 10 ? 2 : 1
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(p.replied).toFixed(1)}`).join(' ')
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: Math.round(max * f), y: y(max * f) }))
  const tip = active != null ? points[active] : null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    setActive((a) => Math.min(n - 1, Math.max(0, (a ?? n - 1) + dir)))
  }

  return (
    <div
      dir='ltr'
      role='group'
      tabIndex={0}
      aria-label='לידים חדשים ולידים שנענו לפי יום. מקשי החצים עוברים בין הימים.'
      onKeyDown={onKeyDown}
      onFocus={() => setActive((a) => a ?? n - 1)}
      onBlur={() => setActive(null)}
      onMouseLeave={() => setActive(null)}
      className='relative rounded-lg pb-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary'
    >
      <svg aria-hidden viewBox={`0 0 ${VB_W} ${VB_H}`} className='block h-auto w-full overflow-visible'>
        {grid.map((g) => (
          <line key={g.v} x1={X0 - 4} x2={X1} y1={g.y} y2={g.y} className='stroke-gray-100' strokeWidth={1} />
        ))}
        {points.map((p, i) => (
          <g key={i}>
            <rect
              x={cx(i) - bw / 2}
              y={y(p.newLeads)}
              width={bw}
              height={Y0 - y(p.newLeads)}
              rx={4}
              className={`transition-opacity ${active == null || active === i ? 'fill-primary' : 'fill-primary opacity-35'}`}
            />
            <rect x={X0 + step * i} y={Y1} width={step} height={Y0 - Y1} fill='transparent' onMouseEnter={() => setActive(i)} />
          </g>
        ))}
        {showReplied && (
          <path d={line} fill='none' className='pointer-events-none stroke-success' strokeWidth={2.5} strokeLinejoin='round' strokeLinecap='round' />
        )}
        {showReplied &&
          n <= 14 &&
          points.map((p, i) => (
            <circle key={i} cx={cx(i)} cy={y(p.replied)} r={4} className='pointer-events-none fill-surface stroke-success' strokeWidth={2.5} />
          ))}
      </svg>

      {grid.map((g) => (
        <span key={g.v} className='pointer-events-none absolute left-0 w-[4.5%] -translate-y-1/2 text-[11px] text-gray-400 tabular-nums' style={{ top: `${(g.y / VB_H) * 100}%` }}>
          {g.v}
        </span>
      ))}
      {points.map((p, i) =>
        i % every === (n - 1) % every ? (
          <span key={i} className='pointer-events-none absolute bottom-0 -translate-x-1/2 text-[11px] whitespace-nowrap text-gray-400 tabular-nums' style={{ left: `${(cx(i) / VB_W) * 100}%` }}>
            {p.short}
          </span>
        ) : null,
      )}

      {tip && (
        <div
          dir='rtl'
          role='status'
          className='pointer-events-none absolute top-0 -translate-x-1/2 rounded-[10px] bg-ink px-3 py-2 text-[13px] whitespace-nowrap text-white shadow-overlay'
          style={{ left: `${(cx(active!) / VB_W) * 100}%` }}
        >
          <div className='mb-0.5 font-bold'>{tip.long}</div>
          <div className='tabular-nums'>{tip.newLeads} לידים חדשים</div>
          {showReplied && <div className='text-success-border tabular-nums'>{tip.replied} נענו</div>}
        </div>
      )}
    </div>
  )
}
