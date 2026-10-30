import { identityProblemIn, skipReasonIn } from '@/lib/automations/catalogI18n'
import type { PilotMetrics } from '@/db/automations/pilotMetrics'
import { regionAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { formatLeadDateTime } from '@/lib/leads/leadDate'

/**
 * INTERNAL pilot dashboard (ADR-014). An operator surface — not a customer
 * feature, not linked from the customer nav, and deliberately plain: it exists
 * to answer "is the engine behaving?" during the pilot window, not to look
 * good. Server component; no interactivity by design.
 */

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'alert' | 'muted' }) {
  return (
    <div className='border rounded-lg bg-white p-4 grid gap-1'>
      <span className='text-sm text-gray-500'>{label}</span>
      <span className={`text-2xl font-semibold ${tone === 'alert' ? 'text-red-600' : 'text-gray-800'}`}>{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className='grid gap-2'>
      <h2 className='text-sm font-semibold text-gray-800'>{title}</h2>
      {children}
    </section>
  )
}

function Rows({ rows, empty }: { rows: Array<{ label: string; count: number }>; empty: string }) {
  if (rows.length === 0) return <p className='text-sm text-gray-500'>{empty}</p>
  return (
    <ul className='border rounded-lg bg-white divide-y'>
      {rows.map((r) => (
        <li key={r.label} className='flex items-center justify-between gap-4 p-3'>
          <span className='text-sm text-gray-700'>{r.label}</span>
          <span className='text-sm font-semibold text-gray-800'>{r.count}</span>
        </li>
      ))}
    </ul>
  )
}

export default function PilotDashboard({ metrics, mode, locale = 'he' }: { metrics: PilotMetrics; mode: 'log' | 'live'; locale?: UiLocale }) {
  const m = metrics
  const t = translatorFor(locale)
  // Thresholds from ADR-014 — any occurrence of these is investigated.
  const identityTotal = m.identityFailures.reduce((s, r) => s + r.count, 0)
  const queueStale = m.queue.oldestPendingAt ? Date.now() - Date.parse(m.queue.oldestPendingAt) > 10 * 60 * 1000 : false

  return (
    <div className='max-w-3xl grid gap-6' {...regionAttrs(locale)}>
      <div className='mb-2'>
        <h1 className='title'>{t('admin.automations.pilot.heading')}</h1>
        <p className='mt-2 max-w-2xl text-sm leading-relaxed text-gray-600'>
          {t('admin.automations.pilot.window', {
            mode: mode === 'log' ? t('admin.automations.pilot.modeLog') : t('admin.automations.pilot.modeLive'),
            days: String(m.windowDays),
          })}
        </p>
      </div>

      <Section title={t('admin.automations.pilot.activity')}>
        <div className='grid grid-cols-2 gap-3 mobile:grid-cols-1'>
          <Stat label={t('admin.automations.pilot.wouldSend')} value={m.observation.wouldSend} />
          <Stat label={t('admin.automations.pilot.sent')} value={m.observation.sent} />
          <Stat label={t('admin.automations.pilot.skipped')} value={m.observation.skipped} tone='muted' />
          <Stat label={t('admin.automations.pilot.failures')} value={m.observation.failed} tone={m.observation.failed > 0 ? 'alert' : undefined} />
        </div>
      </Section>

      <Section title={t('admin.automations.pilot.skipReasons')}>
        <Rows
          rows={m.skipReasons.map((r) => ({
            label: skipReasonIn(r.reason, locale) ?? r.reason,
            count: r.count,
          }))}
          empty={t('admin.automations.pilot.noSkips')}
        />
      </Section>

      <Section title={t('admin.automations.pilot.identity')}>
        {identityTotal > 0 && (
          <p className='text-sm text-red-600' role='alert'>
            {t('admin.automations.pilot.identityAlert')}
          </p>
        )}
        <Rows
          rows={m.identityFailures.map((r) => ({
            label: identityProblemIn(r.problem, locale) ?? r.problem,
            count: r.count,
          }))}
          empty={t('admin.automations.pilot.noIdentity')}
        />
      </Section>

      <Section title={t('admin.automations.pilot.delivery')}>
        <div className='grid grid-cols-2 gap-3 mobile:grid-cols-1'>
          <Stat label={t('admin.automations.pilot.delivered')} value={m.delivery.delivered} />
          <Stat label={t('admin.automations.pilot.deliveryFailed')} value={m.delivery.failed} tone={m.delivery.failed > 0 ? 'alert' : undefined} />
          <Stat label={t('admin.automations.pilot.bounces')} value={m.bounces} tone={m.bounces > 0 ? 'alert' : undefined} />
          <Stat label={t('admin.automations.pilot.blocked')} value={m.blockedAddresses} />
        </div>
      </Section>

      <Section title={t('admin.automations.pilot.suppressions')}>
        <div className='grid grid-cols-2 gap-3 mobile:grid-cols-1'>
          <Stat label={t('admin.automations.pilot.suppressionsTotal')} value={m.suppressions.total} />
          <Stat
            label={t('admin.automations.pilot.complaints')}
            value={m.suppressions.complaint}
            tone={m.suppressions.complaint > 0 ? 'alert' : undefined}
          />
        </div>
        {m.suppressions.complaint > 0 && (
          <p className='text-sm text-red-600' role='alert'>
            {t('admin.automations.pilot.complaintAlert')}
          </p>
        )}
      </Section>

      <Section title={t('admin.automations.pilot.queue')}>
        <div className='grid grid-cols-2 gap-3 mobile:grid-cols-1'>
          <Stat label={t('admin.automations.pilot.pending')} value={m.queue.pending} tone={queueStale ? 'alert' : undefined} />
          <Stat label={t('admin.automations.pilot.processing')} value={m.queue.processing} />
          <Stat label={t('admin.automations.pilot.dead')} value={m.queue.dead} tone={m.queue.dead > 0 ? 'alert' : undefined} />
          <Stat
            label={t('admin.automations.pilot.oldest')}
            value={
              !m.queue.oldestPendingAt
                ? '—'
                : locale === 'he'
                  ? new Date(m.queue.oldestPendingAt).toLocaleString('he-IL')
                  : formatLeadDateTime(locale, m.queue.oldestPendingAt)
            }
          />
        </div>
        {queueStale && (
          <p className='text-sm text-red-600' role='alert'>
            {t('admin.automations.pilot.queueAlert')}
          </p>
        )}
      </Section>
    </div>
  )
}
