'use client'

import type { GeneralAnswer } from '@/actions/ai/askGeneralQuestion'
import type { BriefingLeadList } from '@/db/briefing'
import { DriveResultsBody } from '../bodies/DriveResultsBody'
import DeepLink from './DeepLink'
import LeadRows from './LeadRows'
import CapabilityMenu from './CapabilityMenu'
import { unansweredMessage } from '@/lib/copilot/general/unansweredMessage'
import { attentionAllClear } from '@/lib/copilot/general/attentionState'
import { buildAttentionDecision } from '@/lib/copilot/general/attentionDecision'

const SOURCE_LABEL: Record<string, string> = {
  'followups.dueToday': 'הלידים שלך',
  'leads.notContactedRecently': 'הלידים שלך',
  'leads.newThisWeek': 'הלידים שלך',
  'tasks.overdue': 'המשימות שלך',
  'meetings.today': 'היומן',
  'inbox.unread': 'התיבה',
  'crm.attention': 'נתוני ה-CRM שלך',
  'system.overview': 'נתוני ה-CRM שלך',
}

type MeetingsPayload = { meetings: { id: number; title: string; leadName: string | null }[] }
type InboxPayload = { conversations: number; unread: number }
type AttentionPayload = { overdue: BriefingLeadList; dueToday: BriefingLeadList; stale: BriefingLeadList }

function DataAnswer({ intent, payload }: { intent: string; payload: unknown }) {
  if (intent === 'system.overview') {
    const p = payload as { summary: string }
    return <p className='text-[13px] text-gray-700'>{p.summary}</p>
  }
  if (intent === 'inbox.unread') {
    const p = payload as InboxPayload
    if (p.unread === 0) return <p className='text-[13px] text-gray-500'>אין הודעות חדשות</p>
    return (
      <DeepLink href='/inbox' source='answer' className='text-[13px] text-gray-700 hover:text-gray-900'>
        {p.unread} הודעות שלא נקראו ב-{p.conversations} שיחות
      </DeepLink>
    )
  }
  if (intent === 'meetings.today') {
    const p = payload as MeetingsPayload
    if (p.meetings.length === 0) return <p className='text-[13px] text-gray-500'>אין פגישות היום</p>
    return (
      <ul className='space-y-0.5'>
        {p.meetings.map((m) => (
          <li key={m.id}>
            <DeepLink href='/calendar' source='answer' className='block truncate text-[13px] text-gray-700 hover:text-gray-900'>
              {m.title}
              {m.leadName ? ` · ${m.leadName}` : ''}
            </DeepLink>
          </li>
        ))}
      </ul>
    )
  }
  if (intent === 'crm.attention') {
    const p = payload as AttentionPayload
    if (attentionAllClear(p)) {
      return (
        <p className='text-[13px] text-gray-500'>
          הכול תחת שליטה. אין כרגע משימות באיחור, מעקבים פתוחים או לידים שמתקררים.
        </p>
      )
    }
    // Deterministic Decision Layer ABOVE the unchanged evidence sections.
    const decision = buildAttentionDecision(p)
    return (
      <div className='space-y-1.5'>
        {decision && (
          <div className='rounded-md bg-gray-50 px-2.5 py-2'>
            <p className='text-[13px] font-semibold text-gray-900'>הכי דחוף כרגע: {decision.leadName}</p>
            <p className='text-[12px] text-gray-600'>הסיבה: {decision.reason}</p>
            {decision.secondary && (
              <p className='mt-0.5 text-[12px] text-gray-500'>
                אחריו: {decision.secondary.count} {decision.secondary.area}
              </p>
            )}
          </div>
        )}
        <Mini label='משימות באיחור' list={p.overdue} empty='אין משימות באיחור' />
        <Mini label='מעקבים להיום' list={p.dueToday} empty='אין מעקבים להיום' />
        <Mini label='לידים שלא בקשר' list={p.stale} empty='הכול בקשר' />
      </div>
    )
  }

  const p = payload as BriefingLeadList
  return <LeadRows total={p.total} sample={p.sample.slice(0, ANSWER_PREVIEW)} emptyText='אין תוצאות' source='answer' />
}

const ANSWER_PREVIEW = 12
const ATTENTION_PREVIEW = 4

function Mini({ label, list, empty }: { label: string; list: BriefingLeadList; empty: string }) {
  return (
    <div>
      <p className='text-[11.5px] font-medium text-gray-500'>
        {label}
        {list.total > 0 ? ` · ${list.total}` : ''}
      </p>
      <LeadRows total={list.total} sample={list.sample.slice(0, ATTENTION_PREVIEW)} emptyText={empty} source='answer' />
    </div>
  )
}

export default function AnswerView({ answer, onPick }: { answer: GeneralAnswer; onPick: (text: string) => void }) {
  if (answer.kind === 'menu') {
   
    return (
      <div className='space-y-2'>
        <p className='text-[13px] text-gray-700'>{unansweredMessage(answer.reason)}</p>
        <CapabilityMenu onPick={onPick} />
      </div>
    )
  }
  if (answer.kind === 'drive') {
    return (
      <div className='rounded-md border border-gray-200 p-2.5'>
        <DriveResultsBody data={answer.data} />
      </div>
    )
  }
  if (answer.kind === 'guide') {
    return (
      <div className='space-y-1.5'>
        <p className='text-[13px] text-gray-700'>{answer.answer}</p>
        {answer.route && (
          <DeepLink
            href={answer.route}
            source='guide'
            className='inline-block text-[12.5px] font-medium text-gray-900 underline-offset-2 hover:underline'
          >
            פתח
          </DeepLink>
        )}
      </div>
    )
  }
  return (
    <div className='rounded-md border border-gray-200 p-2.5'>
      <DataAnswer intent={answer.intent} payload={answer.payload} />
      {SOURCE_LABEL[answer.intent] && (
        <p className='mt-2 text-[10px] tracking-wide text-gray-400'>מקור: {SOURCE_LABEL[answer.intent]}</p>
      )}
    </div>
  )
}
