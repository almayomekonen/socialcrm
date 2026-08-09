import type { PlanUsage, UsageMetric } from '@/lib/quota/planUsage'

export default function SubscriptionUsage({ usage }: { usage: PlanUsage }) {
  return (
    <section className='mt-10'>
      <h2 className='text-xl font-bold text-dark'>השימוש במסלול שלכם</h2>
      <div className='mt-4 max-w-3xl rounded-lg border border-gray-200 bg-white p-6'>
        {/* Stacks below 768px — the same boundary as the `mobile` variant, so
            the columns never sit at Hebrew-hostile widths on a phone. */}
        <div className='grid gap-8 md:grid-cols-3'>
          <UsageColumn
            label='לידים'
            metric={usage.leads}
            value={usage.leads.used.toLocaleString('he-IL')}
            note={usage.leads.limit === null ? 'נכנסו החודש. אין תקרה במסלול Pro' : 'נכנסו החודש'}
          />

          {usage.automations && (
            <UsageColumn
              label='אוטומציות'
              metric={usage.automations}
              value={usage.automations.used.toLocaleString('he-IL')}
              note={
                usage.automations.created > 0
                  ? `פעילות כרגע, מתוך ${usage.automations.created} שיצרתם`
                  : 'עדיין לא יצרתם אוטומציות'
              }
            />
          )}

          <UsageColumn
            label='בקשות AI'
            metric={usage.ai}
            value={usage.ai.used.toLocaleString('he-IL')}
            note='ניסוח, סיכום והמלצות. כלולות במסלול'
          />
        </div>
      </div>
    </section>
  )
}

function UsageColumn({
  label,
  value,
  note,
  metric,
}: {
  label: string
  value: string
  note: string
  metric: UsageMetric
}) {
  const capped = metric.limit !== null
  // Clamped: a count above its own limit (grandfathered data, a limit lowered
  // after the fact) must read as full, never as a bar overflowing its track.
  const percent = capped ? Math.min(100, Math.round((metric.used / Math.max(1, metric.limit!)) * 100)) : 0

  return (
    <div className='flex flex-col gap-2.5'>
      <div className='flex items-baseline justify-between gap-3'>
        <span className='text-sm text-gray-900'>{label}</span>
        <span className='text-sm text-gray-500'>{capped ? `${value} מתוך ${metric.limit}` : value}</span>
      </div>

      {capped && (
        <div
          role='progressbar'
          aria-label={label}
          aria-valuenow={metric.used}
          aria-valuemin={0}
          aria-valuemax={metric.limit!}
          className='h-1.5 overflow-hidden rounded-full bg-gray-100'
        >
          <div className='h-full rounded-full bg-solid' style={{ width: `${percent}%` }} />
        </div>
      )}

      <p className='text-xs text-gray-500'>{note}</p>
    </div>
  )
}
