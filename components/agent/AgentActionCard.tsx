'use client'

import Icon from '@/lib/Icon'
import { actionReportLabel } from './agentTypes'
import type { ActionOutcome } from '@/lib/agent/actions/types'
import type { ProposedAction } from '@/lib/agent/types'

/**
 * One action, and what the application says became of it.
 *
 * THE RULE THIS COMPONENT HOLDS: every word about what happened comes from
 * `outcome`, and never from the agent's prose. The model writes its answer
 * BEFORE the action runs, so it cannot know; a missing outcome renders as
 * waiting, never as done. There is no branch here that derives success from the
 * proposal, from the absence of an error, or from anything the model said.
 *
 * THE CONFIRMATION IS THE HEADLINE, THE PROOF IS THE FOOTNOTE. A rep wants to
 * read "יצרתי את המשימה 'לחזור לדניאל' עבור דניאל כהן ל־7.9.2026" — not
 * "VERIFIED_SUCCESS", and not a verification vocabulary they never asked to
 * learn. So the natural sentence is primary and the check count sits under it as
 * a quiet "✓ אומת מול המערכת — 5/5". The detailed arguments stay on the card in
 * both cases, because what was approved and what ran must be comparable
 * afterwards.
 *
 * THE LEAD'S NAME COMES FROM THE VERIFIER, which read it back from the database
 * a moment ago — not from the model, which only ever saw it in a tool result.
 * A name in a sentence that says something happened should be a name that was
 * really there.
 *
 * A FOLLOW-UP IS NEVER A TASK. The two actions get different verbs, different
 * rows and different status wording; a rep told "המשימה נוצרה" for a follow-up
 * would go looking in the wrong place.
 */
export default function AgentActionCard({
  proposal,
  outcome,
  pending,
  onDecide,
}: {
  proposal: ProposedAction
  outcome?: ActionOutcome | null
  pending?: boolean
  onDecide?: (decision: 'APPROVED' | 'REJECTED') => void
}) {
  const report = outcome?.report ?? 'AWAITING_APPROVAL'
  const label = actionReportLabel(report, proposal.actionType)
  const awaiting = report === 'AWAITING_APPROVAL'
  const verified = outcome?.verification?.verified === true
  const checks = outcome?.verification?.checks ?? []
  const passed = checks.filter((c) => c.ok).length
  const leadName = outcome?.verification?.targetIds?.find((t) => t.label)?.label
  const described = describeAction(proposal, { verified, leadName, outcome })

  return (
    <article
      className='space-y-3 rounded-md border bg-white px-4 py-3.5'
    >
      <header className='flex items-start gap-3'>
        <span className='mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-tint'>
          <Icon name={actionIcon(proposal.actionType)} type='sol' className='size-3.5 bg-primary' />
        </span>
        <div className='min-w-0 flex-1'>
          <p className='text-[15px] font-medium leading-6 text-ink'>
            {verified ? described.confirmed : described.heading}
          </p>
          {/* Verified: the proof, quietly. Otherwise: what state this is in. */}
          {verified && checks.length > 0 ? (
            <p className='text-sm leading-6 text-success-text'>
              ✓ אומת מול המערכת — {passed}/{checks.length}
            </p>
          ) : (
            <p className={`text-sm leading-6 ${toneClass(label.tone)}`}>{label.title}</p>
          )}
        </div>
      </header>

      {/* What will run, or what ran. Present in both cases so the rep can check
          afterwards that the thing they approved is the thing that happened. */}
      <dl className='space-y-1 text-sm leading-6'>
        {described.rows.map((row) => (
          <Row key={row.term} term={row.term} value={row.value} />
        ))}
      </dl>

      {awaiting && onDecide && (
        <div className='flex gap-2 pt-0.5'>
          <button
            type='button'
            disabled={pending}
            onClick={() => onDecide('APPROVED')}
            className='rounded-md bg-solid px-3.5 py-2 text-sm font-medium text-white transition hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50'
          >
            {pending ? described.working : described.confirmLabel}
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

      {report === 'UNKNOWN_RECONCILE' && (
        <p className='text-sm leading-6 text-gray-600'>
          כדאי לבדוק במערכת אם הפעולה כבר קיימת לפני שמנסים שוב, כדי לא לבצע אותה פעמיים.
        </p>
      )}
    </article>
  )
}

function actionIcon(actionType: ProposedAction['actionType']) {
  if (actionType === 'create_meeting') return 'calendar-days' as const
  if (actionType === 'create_follow_up') return 'calendar-check' as const
  return 'clipboard-check' as const
}

/** `2026-09-07` → `7.9.2026`. The form a Hebrew reader expects to see. */
function displayDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${Number(d)}.${Number(m)}.${y}`
}

/** "עבור דניאל כהן", or nothing when the verifier could not read a name. */
const forLead = (leadName?: string) => (leadName ? ` עבור ${leadName}` : '')

function describeAction(
  proposal: ProposedAction,
  ctx: { verified: boolean; leadName?: string; outcome?: ActionOutcome | null },
): { heading: string; confirmed: string; confirmLabel: string; working: string; rows: { term: string; value: string }[] } {
  if (proposal.actionType === 'create_follow_up') {
    const note = proposal.args.note?.trim()
    const when = displayDate(proposal.args.at)
    /**
     * "קבעתי" or "עדכנתי", decided by what the executor actually found. Setting
     * a follow-up replaces any existing one, and a rep whose date was replaced
     * should be told that rather than shown a word that implies there was
     * nothing there before.
     */
    const replaced = (ctx.outcome?.execution?.detail as { replacedExisting?: boolean } | undefined)?.replacedExisting === true
    const verb = replaced ? 'עדכנתי את המעקב' : 'קבעתי מעקב'
    return {
      heading: 'קביעת מעקב',
      confirmed: `${verb}${forLead(ctx.leadName)} ל־${when}${note ? ` עם ההערה '${note}'` : ''}.`,
      confirmLabel: 'אשר וקבע מעקב',
      working: 'קובע מעקב…',
      rows: [
        { term: 'תאריך מעקב', value: when },
        ...(note ? [{ term: 'הערה', value: note }] : []),
        { term: 'ליד', value: ctx.leadName ?? `#${proposal.args.clientId}` },
      ],
    }
  }

  if (proposal.actionType === 'create_meeting') {
    const { date, startTime, durationMinutes, title } = proposal.args
    const note = proposal.args.note?.trim()
    const when = `${displayDate(date)} בשעה ${startTime}`
    return {
      heading: 'קביעת פגישה',
      // A meeting is never "a task": different word, different screen.
      confirmed: `יצרתי את הפגישה '${title}'${forLead(ctx.leadName)} ל־${when}.`,
      confirmLabel: 'אשר וקבע פגישה',
      working: 'קובע פגישה…',
      rows: [
        { term: 'כותרת', value: title },
        { term: 'מועד', value: when },
        { term: 'משך', value: `${durationMinutes} דקות` },
        ...(note ? [{ term: 'הערה', value: note }] : []),
        { term: 'ליד', value: ctx.leadName ?? `#${proposal.args.clientId}` },
      ],
    }
  }

  const due = displayDate(proposal.args.dueDate)
  return {
    heading: 'יצירת משימה',
    confirmed: `יצרתי את המשימה '${proposal.args.title}'${forLead(ctx.leadName)} ל־${due}.`,
    confirmLabel: 'אשר ויצור משימה',
    working: 'יוצר משימה…',
    rows: [
      { term: 'כותרת', value: proposal.args.title },
      { term: 'תאריך יעד', value: due },
      { term: 'ליד', value: ctx.leadName ?? `#${proposal.args.clientId}` },
    ],
  }
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className='flex gap-2'>
      <dt className='shrink-0 text-gray-600'>{term}</dt>
      <dd className='min-w-0 flex-1 truncate text-gray-800'>{value}</dd>
    </div>
  )
}

/** Colour carries meaning here, and only meaning — never decoration. */
function toneClass(tone: 'wait' | 'ok' | 'bad' | 'warn'): string {
  if (tone === 'ok') return 'text-success-text'
  if (tone === 'bad') return 'text-error-text'
  if (tone === 'warn') return 'text-warning-text'
  return 'text-gray-600'
}
