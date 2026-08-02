import { SKIP_REASON_COPY } from '@/lib/automations/copy'
import { IDENTITY_PROBLEM_COPY, type IdentityProblem } from '@/lib/automations/identity'
import type { PilotMetrics } from '@/db/automations/pilotMetrics'
import type { SkipReason } from '@/lib/automations/types'

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

export default function PilotDashboard({ metrics, mode }: { metrics: PilotMetrics; mode: 'log' | 'live' }) {
  const m = metrics
  // Thresholds from ADR-014 — any occurrence of these is investigated.
  const identityTotal = m.identityFailures.reduce((s, r) => s + r.count, 0)
  const queueStale = m.queue.oldestPendingAt ? Date.now() - Date.parse(m.queue.oldestPendingAt) > 10 * 60 * 1000 : false

  return (
    <div className='max-w-3xl grid gap-6'>
      <div>
        <h1 className='title'>מדדי פיילוט — פנימי</h1>
        <p className='text-sm text-gray-500 mt-1'>
          {mode === 'log' ? 'מצב תצפית — לא נשלחים אימיילים בפועל' : 'מצב שליחה חי'} · {m.windowDays} הימים האחרונים ·
          נתוני העסק הזה בלבד
        </p>
      </div>

      <Section title='פעילות'>
        <div className='grid grid-cols-2 gap-3 mobile:grid-cols-1'>
          <Stat label='היו נשלחים (תצפית)' value={m.observation.wouldSend} />
          <Stat label='נשלחו בפועל' value={m.observation.sent} />
          <Stat label='דילוגים' value={m.observation.skipped} tone='muted' />
          <Stat label='כשלים' value={m.observation.failed} tone={m.observation.failed > 0 ? 'alert' : undefined} />
        </div>
      </Section>

      <Section title='סיבות דילוג'>
        <Rows
          rows={m.skipReasons.map((r) => ({
            label: SKIP_REASON_COPY[r.reason as SkipReason] ?? r.reason,
            count: r.count,
          }))}
          empty='אין דילוגים בחלון הזמן'
        />
      </Section>

      <Section title='כשלי זהות שולח'>
        {identityTotal > 0 && (
          <p className='text-sm text-red-600' role='alert'>
            כל כשל זהות משמעו שליחה אמיתית שנמנעה — יש לטפל.
          </p>
        )}
        <Rows
          rows={m.identityFailures.map((r) => ({
            label: IDENTITY_PROBLEM_COPY[r.problem as IdentityProblem] ?? r.problem,
            count: r.count,
          }))}
          empty='אין כשלי זהות'
        />
      </Section>

      <Section title='מסירה'>
        <div className='grid grid-cols-2 gap-3 mobile:grid-cols-1'>
          <Stat label='נמסרו' value={m.delivery.delivered} />
          <Stat label='נכשלו במסירה' value={m.delivery.failed} tone={m.delivery.failed > 0 ? 'alert' : undefined} />
          <Stat label='הוחזרו (bounce)' value={m.bounces} tone={m.bounces > 0 ? 'alert' : undefined} />
          <Stat label='כתובות חסומות' value={m.blockedAddresses} />
        </div>
      </Section>

      <Section title='הסרות מרשימת התפוצה'>
        <div className='grid grid-cols-2 gap-3 mobile:grid-cols-1'>
          <Stat label='סה״כ הסרות' value={m.suppressions.total} />
          <Stat
            label='תלונות ספאם'
            value={m.suppressions.complaint}
            tone={m.suppressions.complaint > 0 ? 'alert' : undefined}
          />
        </div>
        {m.suppressions.complaint > 0 && (
          <p className='text-sm text-red-600' role='alert'>
            תלונת ספאם היא אירוע SEV-2 — יש לבדוק מיד.
          </p>
        )}
      </Section>

      <Section title='תור העבודה'>
        <div className='grid grid-cols-2 gap-3 mobile:grid-cols-1'>
          <Stat label='ממתינות' value={m.queue.pending} tone={queueStale ? 'alert' : undefined} />
          <Stat label='בעיבוד' value={m.queue.processing} />
          <Stat label='מתות (dead)' value={m.queue.dead} tone={m.queue.dead > 0 ? 'alert' : undefined} />
          <Stat
            label='הממתינה הוותיקה ביותר'
            value={m.queue.oldestPendingAt ? new Date(m.queue.oldestPendingAt).toLocaleString('he-IL') : '—'}
          />
        </div>
        {queueStale && (
          <p className='text-sm text-red-600' role='alert'>
            יש עבודה שממתינה מעל שני מחזורי קרון — ייתכן שהניקוז אינו פועל.
          </p>
        )}
      </Section>
    </div>
  )
}
