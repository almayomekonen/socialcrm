'use client'

import type { GeneralAnswer } from '@/actions/ai/askGeneralQuestion'
import type { BriefingLeadList } from '@/db/briefing'
import { DriveResultsBody } from '../bodies/DriveResultsBody'
import DeepLink from './DeepLink'
import LeadRows from './LeadRows'
import CapabilityMenu from './CapabilityMenu'

/** Deterministic "knowledge source" label per data intent (no model involved). */
const SOURCE_LABEL: Record<string, string> = {
  'followups.dueToday': 'הלידים שלך',
  'leads.notContactedRecently': 'הלידים שלך',
  'leads.newThisWeek': 'הלידים שלך',
  'tasks.overdue': 'המשימות שלך',
  'meetings.today': 'היומן',
  'inbox.unread': 'התיבה',
  'crm.attention': 'נתוני ה-CRM שלך',
}

type MeetingsPayload = { meetings: { id: number; title: string; leadName: string | null }[] }
type InboxPayload = { conversations: number; unread: number }
type AttentionPayload = { overdue: BriefingLeadList; dueToday: BriefingLeadList; stale: BriefingLeadList }

function DataAnswer({ intent, payload }: { intent: string; payload: unknown }) {
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
    return (
      <div className='space-y-1.5'>
        <Mini label='משימות באיחור' list={p.overdue} empty='אין משימות באיחור' />
        <Mini label='מעקבים להיום' list={p.dueToday} empty='אין מעקבים להיום' />
        <Mini label='לידים שלא בקשר' list={p.stale} empty='הכול בקשר' />
      </div>
    )
  }
  // Lead-list intents (followups.dueToday / leads.* / tasks.overdue).
  const p = payload as BriefingLeadList
  return <LeadRows total={p.total} sample={p.sample} emptyText='אין תוצאות' source='answer' />
}

function Mini({ label, list, empty }: { label: string; list: BriefingLeadList; empty: string }) {
  return (
    <div>
      <p className='text-[11.5px] font-medium text-gray-500'>
        {label}
        {list.total > 0 ? ` · ${list.total}` : ''}
      </p>
      <LeadRows total={list.total} sample={list.sample} emptyText={empty} source='answer' />
    </div>
  )
}

/** Renders one Q&A outcome: data card, drive results, guide answer, or menu. */
export default function AnswerView({ answer, onPick }: { answer: GeneralAnswer; onPick: (text: string) => void }) {
  if (answer.kind === 'menu') return <CapabilityMenu onPick={onPick} />
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
