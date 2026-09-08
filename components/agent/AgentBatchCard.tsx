'use client'

import Icon from '@/lib/Icon'
import type { BatchOutcome } from '@/lib/agent/actions/batch'
import type { ProposedBatch } from '@/lib/agent/types'

/**
 * One card for a whole batch — not N conversational approvals.
 *
 * A rep asked one question and should answer one question. Rendering a card per
 * lead would turn "create a task for everyone with no next step" into seven
 * decisions, which is the opposite of what they asked for.
 *
 * BUT THE RESULT IS NEVER ONE NUMBER. Each task was created, claimed, verified
 * and audited independently, so the outcome is genuinely a split — and the split
 * is what gets shown. "נוצרו ואומתו 6" beside "1 לא בוצע" is the truth; "נוצרו 7"
 * would be a lie the rep only discovers when a lead is missing a task.
 *
 * EVERY WORD ABOUT WHAT HAPPENED COMES FROM `outcome`. The model's prose is
 * written before any of this runs, so an absent outcome renders as waiting.
 *
 * NAMES APPEAR ONLY AFTER VERIFICATION, because that is when the application
 * has them: the verifier reads each lead back from the database. Before
 * approval the card shows the count and the shared arguments, which is what was
 * actually decided.
 */
export default function AgentBatchCard({
  batch,
  outcome,
  pending,
  onDecide,
}: {
  batch: ProposedBatch
  outcome?: BatchOutcome | null
  pending?: boolean
  onDecide?: (decision: 'APPROVED' | 'REJECTED') => void
}) {
  const report = outcome?.report ?? 'AWAITING_APPROVAL'
  const awaiting = report === 'AWAITING_APPROVAL'
  const summary = outcome?.summary
  const names = (outcome?.outcomes ?? [])
    .flatMap((o) => o.verification?.targetIds ?? [])
    .map((t) => t.label)
    .filter((label): label is string => Boolean(label))

  return (
    <article
      className='space-y-3 rounded-md border bg-white px-4 py-3.5'
    >
      <header className='flex items-start gap-3'>
        <span className='mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-tint'>
          <Icon name='clipboard-check' type='sol' className='size-3.5 bg-primary' />
        </span>
        <div className='min-w-0 flex-1'>
          <p className='text-[15px] font-medium leading-6 text-ink'>{headline(batch, outcome)}</p>
          <p className={`text-sm leading-6 ${toneClass(report)}`}>{statusLine(report, outcome)}</p>
        </div>
      </header>

      <dl className='space-y-1 text-sm leading-6'>
        <Row term='כותרת' value={batch.args.title} />
        <Row term='תאריך יעד' value={displayDate(batch.args.dueDate)} />
        <Row term='לידים' value={targetPreview(batch, names)} />
      </dl>

      {/* Partial results are spelled out, never averaged into a verdict. */}
      {summary && summary.total > 0 && report !== 'AWAITING_APPROVAL' && (
        <ul className='space-y-0.5 text-sm leading-6 text-gray-600'>
          {summary.verified > 0 && <li>{summary.verified} נוצרו ואומתו</li>}
          {summary.duplicates > 0 && <li>{summary.duplicates} כבר היו קיימות — לא נוצרו שוב</li>}
          {summary.failed > 0 && <li>{summary.failed} לא בוצעו</li>}
          {summary.unknown > 0 && <li>{summary.unknown} לא ניתן לאמת — כדאי לבדוק ידנית</li>}
        </ul>
      )}

      {report === 'OVER_LIMIT' && outcome && (
        <p className='text-sm leading-6 text-gray-600'>
          נמצאו {outcome.eligible} לידים, ואפשר לטפל בעד {outcome.limit} בבת אחת. אפשר לצמצם את הבקשה — למשל לפי סטטוס
          או לפי תאריך — ואז אבצע.
        </p>
      )}

      {awaiting && onDecide && (
        <div className='flex gap-2 pt-0.5'>
          <button
            type='button'
            disabled={pending}
            onClick={() => onDecide('APPROVED')}
            className='rounded-md bg-solid px-3.5 py-2 text-sm font-medium text-white transition hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50'
          >
            {pending ? 'יוצר משימות…' : `אשר ויצור ${batch.targets.length} משימות`}
          </button>
          <button
            type='button'
            disabled={pending}
            onClick={() => onDecide('REJECTED')}
            className='rounded-md border bg-white px-3.5 py-2 text-sm font-medium text-ink transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50'
          >
            בטל
          </button>
        </div>
      )}
    </article>
  )
}

/** The application's sentence, rendered only from what the runtime reported. */
function headline(batch: ProposedBatch, outcome?: BatchOutcome | null): string {
  const n = outcome?.summary.total || batch.targets.length
  switch (outcome?.report) {
    case 'ALL_SUCCEEDED':
      return `יצרתי ${outcome.summary.verified + outcome.summary.duplicates} משימות.`
    case 'PARTIAL_SUCCESS':
      // Named as partial in the headline itself, not buried in a footnote.
      return `יצרתי ${outcome.summary.verified + outcome.summary.duplicates} מתוך ${outcome.summary.total} משימות.`
    case 'NO_ACTIONS':
      return 'לא נמצאו לידים מתאימים.'
    case 'OVER_LIMIT':
      return 'יותר מדי לידים לפעולה אחת.'
    case 'ALL_FAILED':
      return 'אף משימה לא נוצרה.'
    default:
      return `יצירת ${n} משימות`
  }
}

function statusLine(report: string, outcome?: BatchOutcome | null): string {
  if (report === 'AWAITING_APPROVAL') return 'ממתין לאישור שלך'
  if (report === 'ALL_SUCCEEDED') return '✓ אומת מול המערכת'
  if (report === 'PARTIAL_SUCCESS') return `הצלחה חלקית — ${outcome?.summary.failed ?? 0} לא בוצעו`
  if (report === 'NO_ACTIONS') return 'לא בוצעה שום פעולה'
  if (report === 'OVER_LIMIT') return 'לא בוצעה שום פעולה'
  return 'הפעולה נכשלה'
}

/** Bounded: a card is for reading, so it never prints an unbounded list. */
function targetPreview(batch: ProposedBatch, names: string[]): string {
  const shown = names.length > 0 ? names : batch.targets.map((id) => `#${id}`)
  const head = shown.slice(0, 3).join(', ')
  return shown.length > 3 ? `${head} ועוד ${shown.length - 3}` : head
}

/** `2026-09-07` → `7.9.2026`. */
function displayDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${Number(d)}.${Number(m)}.${y}` : iso
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className='flex gap-2'>
      <dt className='shrink-0 text-gray-600'>{term}</dt>
      <dd className='min-w-0 flex-1 truncate text-gray-800'>{value}</dd>
    </div>
  )
}

/** Colour carries meaning only. Partial is warned about, never shown as success. */
function toneClass(report: string): string {
  if (report === 'ALL_SUCCEEDED') return 'text-success-text'
  if (report === 'PARTIAL_SUCCESS') return 'text-warning-text'
  if (report === 'AWAITING_APPROVAL') return 'text-gray-600'
  return 'text-error-text'
}
