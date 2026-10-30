import type { PlanUsage, UsageMetric } from '@/lib/quota/planUsage'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'


export default function SubscriptionUsage({ usage, locale = 'he' }: { usage: PlanUsage; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <section className='mt-10'>
      <h2 className='text-xl font-bold text-dark'>{t('settings.payment.usage.title')}</h2>
      <div className='mt-4 max-w-3xl rounded-lg border border-gray-200 bg-white p-6'>
        {/* Stacks below 768px — the same boundary as the `mobile` variant, so
            the columns never sit at Hebrew-hostile widths on a phone. */}
        <div className='grid gap-8 md:grid-cols-3'>
          <UsageColumn
            label={t('settings.payment.usage.leads')}
            metric={usage.leads}
            locale={locale}
            value={usage.leads.used.toLocaleString('he-IL')}
            note={usage.leads.limit === null ? t('settings.payment.usage.leadsUncapped') : t('settings.payment.usage.leadsCapped')}
          />

          {usage.automations && (
            <UsageColumn
              label={t('settings.payment.usage.automations')}
              metric={usage.automations}
              locale={locale}
              value={usage.automations.used.toLocaleString('he-IL')}
              note={
                usage.automations.created > 0
                  ? t('settings.payment.usage.automationsActive', { count: usage.automations.created })
                  : t('settings.payment.usage.automationsNone')
              }
            />
          )}

          <UsageColumn
            label={t('settings.payment.usage.ai')}
            metric={usage.ai}
            locale={locale}
            value={usage.ai.used.toLocaleString('he-IL')}
            note={t('settings.payment.usage.aiNote')}
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
  locale,
}: {
  label: string
  value: string
  note: string
  metric: UsageMetric
  locale: UiLocale
}) {
  const capped = metric.limit !== null
  // Clamped: a count above its own limit (grandfathered data, a limit lowered
  // after the fact) must read as full, never as a bar overflowing its track.
  const percent = capped ? Math.min(100, Math.round((metric.used / Math.max(1, metric.limit!)) * 100)) : 0

  return (
    <div className='flex flex-col gap-2.5'>
      <div className='flex items-baseline justify-between gap-3'>
        <span className='text-sm text-gray-900'>{label}</span>
        <span className='text-sm text-gray-500'>{capped ? translatorFor(locale)('settings.payment.usage.of', { value, limit: String(metric.limit) }) : value}</span>
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
