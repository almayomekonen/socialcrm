'use client'

import Icon from '@/lib/Icon'
import { actionReportLabel } from './agentTypes'
import type { ActionOutcome } from '@/lib/agent/actions/types'
import type { ProposedAction } from '@/lib/agent/types'

/**
 * One proposed action, and what the application says became of it.
 *
 * THE RULE THIS COMPONENT EXISTS TO HOLD: the status line comes from
 * `outcome.report` and from nothing else. The agent's prose may say it "will
 * create a task"; only the Action Runtime can say one was created, and only
 * after a verifier read it back. So there is no branch here that derives success
 * from the proposal, from the absence of an error, or from anything the model
 * wrote — an outcome that is missing renders as "waiting", never as done.
 *
 * EVERY STATE IS DISTINCT, deliberately. "Created and verified", "sent but I
 * could not confirm it", and "I cannot tell what happened" are three different
 * situations for a rep, and collapsing them into a tick would be the exact lie
 * this architecture was built to prevent.
 *
 * THE ARGUMENTS ARE SHOWN BEFORE THEY RUN, in full, because that is what makes
 * the approval real: the hash the button sends is bound to these exact values,
 * so what is on screen is what will execute.
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
  const label = actionReportLabel(report)
  const awaiting = report === 'AWAITING_APPROVAL'
  const verified = outcome?.verification?.verified === true
  const described = describeAction(proposal)

  return (
    <article
      className={[
        'space-y-3 rounded-2xl bg-white/10 px-4 py-3.5 ring-1 ring-white/20 backdrop-blur-xl',
        'shadow-[0_1px_2px_rgba(0,0,0,0.15),0_12px_28px_-18px_rgba(0,0,0,0.7)]',
      ].join(' ')}
    >
      <header className='flex items-start gap-3'>
        <span className='mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/15'>
          <Icon name='clipboard-check' type='sol' className='size-3.5 bg-white' />
        </span>
        <div className='min-w-0 flex-1'>
          {/* THE APPLICATION SAYS "created", NEVER THE MODEL. The agent writes
              its answer before the action runs, so it cannot know; this line is
              rendered only from a verified outcome, which is the one thing that
              can. */}
          <p className='text-[15px] font-medium leading-6 text-white'>
            {verified ? described.confirmed : described.heading}
          </p>
          <p className={`text-sm leading-6 ${toneClass(label.tone)}`}>{label.title}</p>
        </div>
      </header>

      {/* What will run, or what ran. Shown in both cases so the rep can check
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
            className='rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink transition disabled:opacity-50'
          >
            {pending ? described.working : described.confirmLabel}
          </button>
          <button
            type='button'
            disabled={pending}
            onClick={() => onDecide('REJECTED')}
            className='rounded-xl bg-white/10 px-3.5 py-2 text-sm font-medium text-white ring-1 ring-white/20 transition disabled:opacity-50'
          >
            בטל
          </button>
        </div>
      )}

      {/* The proof, when there is proof. Named checks rather than a tick: the
          rep can see WHAT was confirmed, which is what makes it worth trusting. */}
      {verified && outcome?.verification?.checks?.length ? (
        <p className='text-sm leading-6 text-white/60'>
          אומת מול המערכת: {outcome.verification.checks.filter((c) => c.ok).length} מתוך{' '}
          {outcome.verification.checks.length} בדיקות עברו.
        </p>
      ) : null}

      {report === 'UNKNOWN_RECONCILE' && (
        <p className='text-sm leading-6 text-white/60'>
          כדאי לבדוק במסך המשימות אם המשימה קיימת לפני שמנסים שוב, כדי לא ליצור אותה פעמיים.
        </p>
      )}
    </article>
  )
}

/**
 * One action, in the rep's words.
 *
 * Per-type rather than generic because the two actions are not the same shape of
 * thing: a task has a title and a due date, a follow-up is a date and a note on
 * the lead itself. Rendering both through one abstract "arguments" table would
 * show a rep field names instead of a sentence.
 */
function describeAction(proposal: ProposedAction): {
  heading: string
  confirmed: string
  confirmLabel: string
  working: string
  rows: { term: string; value: string }[]
} {
  if (proposal.actionType === 'create_follow_up') {
    const note = proposal.args.note?.trim()
    return {
      heading: 'קביעת מעקב',
      confirmed: `קבעתי מעקב ל־${proposal.args.at}`,
      confirmLabel: 'אשר וקבע מעקב',
      working: 'קובע מעקב…',
      rows: [
        { term: 'תאריך מעקב', value: proposal.args.at },
        ...(note ? [{ term: 'הערה', value: note }] : []),
        { term: 'ליד', value: `#${proposal.args.clientId}` },
      ],
    }
  }
  return {
    heading: 'יצירת משימה',
    confirmed: `יצרתי את המשימה: ${proposal.args.title}`,
    confirmLabel: 'אשר ויצור משימה',
    working: 'יוצר משימה…',
    rows: [
      { term: 'כותרת', value: proposal.args.title },
      { term: 'תאריך יעד', value: proposal.args.dueDate },
      { term: 'ליד', value: `#${proposal.args.clientId}` },
    ],
  }
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className='flex gap-2'>
      <dt className='shrink-0 text-white/50'>{term}</dt>
      <dd className='min-w-0 flex-1 truncate text-white/85'>{value}</dd>
    </div>
  )
}

/** Colour carries meaning here, and only meaning — never decoration. */
function toneClass(tone: 'wait' | 'ok' | 'bad' | 'warn'): string {
  if (tone === 'ok') return 'text-emerald-300'
  if (tone === 'bad') return 'text-white/55'
  if (tone === 'warn') return 'text-amber-300'
  return 'text-white/70'
}
