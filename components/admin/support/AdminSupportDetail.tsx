import { StatusBadge } from '@/lib/StatusBadge'
import { timeAgo } from '@/components/settings/connections/copy'
import { CATEGORY_COPY, KIND_COPY } from '@/lib/support/copy'
import { ADMIN_STATUS_COPY } from '@/lib/support/adminCopy'
import type { AdminSupportRow } from '@/db/support/admin'
import type { SupportMessageRow } from '@/db/support/messages'

/**
 * The seven questions the owner needs answered, in the order they need them:
 * who, which account, what, what was SocialCRM doing, what does the system
 * already know, what has been said, and then the reply box.
 *
 * `context.facts` is the whole point of the feature — it is populated in Phase 4
 * and renders as an empty-safe block until then.
 */
export default function AdminSupportDetail({
  request,
  messages,
}: {
  request: AdminSupportRow
  messages: SupportMessageRow[]
}) {
  const status = ADMIN_STATUS_COPY[request.status]
  const facts = Array.isArray((request.context as any)?.facts)
    ? (request.context as any).facts
    : []
  const d = (request.diagnostics ?? {}) as Record<string, unknown>
  const visibleMessages = messages.filter((m) => (m.body ?? '').trim().length > 0)

  return (
    <>
      <header className='mb-6'>
        <div className='flex flex-wrap items-center gap-3'>
          <h1 className='text-2xl font-bold text-gray-900'>{request.subject}</h1>
          <StatusBadge role={status.role} label={status.label} />
        </div>
        <p className='mt-1.5 text-sm text-gray-500'>
          {request.agencyName ?? `Agency ${request.agencyId}`}
          {' · '}
          {KIND_COPY[request.kind].tileTitle}
          {' · '}
          {CATEGORY_COPY[request.category]}
        </p>
      </header>

      <dl className='mb-6 grid gap-x-6 gap-y-2 rounded-2xl border border-gray-200 bg-white p-4 text-sm desktop:grid-cols-2'>
        <Row label='מי'>
          {request.requesterNameSnapshot || '—'}
          {request.requesterEmailSnapshot ? ` · ${request.requesterEmailSnapshot}` : ''}
          {request.createdByUserId == null && (
            <span className='me-2 text-xs text-amber-700'>(המשתמש נמחק)</span>
          )}
        </Row>
        <Row label='חשבון'>
          {request.agencyName ?? '—'}{' '}
          <span className='text-gray-400'>(agencyId {request.agencyId})</span>
        </Row>
      </dl>

      {facts.length > 0 && (
        <section className='mb-6 rounded-2xl border border-gray-200 bg-white p-4'>
          <h2 className='mb-2 text-sm font-bold text-gray-900'>מה המערכת יודעת</h2>
          <dl className='grid gap-x-6 gap-y-1 text-sm desktop:grid-cols-2'>
            {facts.map((f: { label: string; value: string }, i: number) => (
              <Row key={i} label={f.label}>
                {f.value}
              </Row>
            ))}
          </dl>
        </section>
      )}

      <section className='mb-6 rounded-2xl border border-gray-200 bg-white p-4'>
        <h2 className='mb-2 text-sm font-bold text-gray-900'>סביבה</h2>
        {/* Rendered as TEXT. clientRoute is untrusted display metadata: never a
            link, never parsed, and it influences nothing server-side. */}
        <p className='text-sm text-gray-600'>
          {[d.clientRoute, d.browser, d.os, d.plan, d.trialStatus, d.appVersion]
            .filter(Boolean)
            .join(' · ') || '—'}
        </p>
      </section>

      <section>
        <h2 className='mb-3 text-sm font-bold text-gray-900'>שיחה</h2>
        {visibleMessages.length === 0 ? (
          <p className='rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400'>
            עדיין אין הודעות בשיחה
          </p>
        ) : (
          <ol className='space-y-3'>
            {visibleMessages.map((m) => {
              const fromCustomer = m.authorKind === 'customer'
              return (
                <li
                  key={m.id}
                  className={
                    fromCustomer
                      ? 'rounded-2xl border border-gray-200 bg-white p-4'
                      : 'rounded-2xl border border-primary/25 border-s-4 border-s-primary bg-primary-tint/40 p-4'
                  }
                >
                  <div className='mb-1.5 flex items-baseline justify-between gap-3'>
                    <span
                      className={`text-sm font-semibold ${
                        fromCustomer ? 'text-gray-900' : 'text-primary-text'
                      }`}
                    >
                      {fromCustomer ? request.requesterNameSnapshot || 'לקוח' : 'צוות SocialCRM'}
                    </span>
                    <span className='shrink-0 text-xs text-gray-400'>
                      {timeAgo(new Date(m.createdAt).toISOString()) ?? '—'}
                    </span>
                  </div>
                  <p className='whitespace-pre-line text-sm leading-relaxed text-gray-700'>{m.body}</p>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex gap-2'>
      <dt className='shrink-0 text-gray-400'>{label}</dt>
      <dd className='min-w-0 text-gray-900'>{children}</dd>
    </div>
  )
}
