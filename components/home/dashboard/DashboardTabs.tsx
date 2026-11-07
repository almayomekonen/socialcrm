'use client'

import { useRef, useState, type ReactNode } from 'react'

// The dashboard's tabbed section — shadcn Tabs (dashboard-01 "Outline / Past
// Performance / Key Personnel") with optional count badges and actions at the end
// of the row. Panels arrive pre-rendered from the server (RSC children); the
// inactive ones stay in the DOM, hidden, so streamed content keeps loading.
// Keyboard: ←/→ move between tabs (direction-aware), Home/End jump.
export type DashboardTab = { id: string; label: string; count?: number; panel: ReactNode }

export default function DashboardTabs({ label, tabs, actions }: { label: string; tabs: DashboardTab[]; actions?: ReactNode }) {
  const [active, setActive] = useState(tabs[0]?.id)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  if (tabs.length === 0) return null
  const current = tabs.some((t) => t.id === active) ? active : tabs[0].id

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    const next = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key as 'ArrowRight' | 'ArrowLeft']
    let to: number | null = null
    if (next != null) to = (i + next + tabs.length) % tabs.length
    if (e.key === 'Home') to = 0
    if (e.key === 'End') to = tabs.length - 1
    if (to == null) return
    e.preventDefault()
    setActive(tabs[to].id)
    refs.current[to]?.focus()
  }

  return (
    <section className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div role='tablist' aria-label={label} className='inline-flex h-9 w-fit items-center rounded-lg bg-neutral-bg p-[3px] text-gray-500'>
          {tabs.map((tab, i) => {
            const on = tab.id === current
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  refs.current[i] = el
                }}
                type='button'
                role='tab'
                id={`dash-tab-${tab.id}`}
                aria-selected={on}
                aria-controls={`dash-panel-${tab.id}`}
                tabIndex={on ? 0 : -1}
                onClick={() => setActive(tab.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={`inline-flex h-[calc(100%-1px)] items-center justify-center gap-1.5 rounded-md border px-2.5 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-primary/25 ${
                  on ? 'border-border bg-surface text-ink shadow-[0_1px_3px_0_rgb(0_0_0/0.1),0_1px_2px_-1px_rgb(0_0_0/0.1)]' : 'border-transparent text-gray-500 hover:text-ink'
                }`}
              >
                {tab.label}
                {tab.count != null && (
                  <span className='inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-tint px-1 text-xs font-medium text-primary-text tabular-nums'>
                    {tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {actions && <div className='flex items-center gap-2'>{actions}</div>}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role='tabpanel'
          id={`dash-panel-${tab.id}`}
          aria-labelledby={`dash-tab-${tab.id}`}
          hidden={tab.id !== current}
        >
          {tab.panel}
        </div>
      ))}
    </section>
  )
}
