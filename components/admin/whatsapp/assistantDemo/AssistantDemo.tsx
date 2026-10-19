'use client'

import { useEffect, useRef, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { SCENARIOS, type DemoMeeting, type DemoScenario, type DemoStep } from './scenarios'

/**
 * SocialCRM AI over WhatsApp, as a SIMULATION. Plays the scripted conversations
 * in ./scenarios: no server action, no API call, no CRM read or write, no
 * message. Every screen says it is a simulation, and each scenario is labelled
 * with what really exists today (pilot vs. not built yet).
 */

type Shown = DemoStep | { kind: 'pending'; label: string }

const AVAILABILITY_LABEL: Record<DemoScenario['availability'], string> = {
  pilot: 'נבנה לפיילוט, עדיין לא פעיל · קריאה בלבד',
  future: 'עדיין לא קיים: שלב 2',
}

export default function AssistantDemo() {
  const [scenario, setScenario] = useState<DemoScenario>(SCENARIOS[0])
  const [shown, setShown] = useState<Shown[]>([])
  const [awaiting, setAwaiting] = useState(false)
  const run = useRef(0)

  function play(steps: DemoStep[], token: number, prefix: Shown[]) {
    let acc = prefix
    let delay = 0
    for (const step of steps) {
      const at = delay
      if (step.kind === 'progress') {
        setTimeout(() => token === run.current && setShown((acc = [...acc, { kind: 'pending', label: step.label }])), at)
        delay += step.ms
        setTimeout(() => token === run.current && setShown((acc = acc.filter((s) => s.kind !== 'pending'))), delay)
        continue
      }
      delay += step.kind === 'owner' ? 500 : 250
      setTimeout(() => {
        if (token !== run.current) return
        setShown((acc = [...acc, step]))
        if (step.kind === 'confirm') setAwaiting(true)
      }, delay)
    }
  }

  function start(next: DemoScenario) {
    run.current += 1
    setScenario(next)
    setShown([])
    setAwaiting(false)
    play(next.steps, run.current, [])
  }

  function decide(confirmed: boolean) {
    setAwaiting(false)
    const steps = (confirmed ? scenario.onConfirm : scenario.onCancel) ?? []
    play(steps, run.current, shown)
  }

  useEffect(() => {
    start(SCENARIOS[0])
    return () => {
      run.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className='grid gap-6 desktop:grid-cols-[16rem_1fr]'>
      <nav aria-label='תרחישים' className='flex flex-col gap-2'>
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type='button'
            onClick={() => start(s)}
            aria-pressed={s.id === scenario.id}
            className={`rounded-xl border px-4 py-3 text-start text-sm transition ${s.id === scenario.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'}`}
          >
            <span className='block font-medium'>{s.title}</span>
            <span className={`mt-0.5 block text-xs ${s.id === scenario.id ? 'text-gray-300' : 'text-gray-500'}`}>{AVAILABILITY_LABEL[s.availability]}</span>
          </button>
        ))}
      </nav>

      <section aria-label='שיחת הדמיה' className='mx-auto w-full max-w-md overflow-hidden rounded-3xl border border-gray-200 bg-[#efeae2] shadow-sm'>
        <header className='flex items-center justify-between bg-[#075e54] px-4 py-3 text-white'>
          <div>
            <p className='text-sm font-semibold'>SocialCRM AI</p>
            <p className='text-xs text-white/75'>העוזר העסקי שלך בוואטסאפ</p>
          </div>
          <span className='rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium'>הדמיה</span>
        </header>
        <p role='note' className='bg-amber-50 px-4 py-2 text-xs text-amber-900'>
          הדמיה בלבד: הנתונים בדויים, ושום הודעה או פעולה לא מתבצעות. {AVAILABILITY_LABEL[scenario.availability]}.
        </p>
        <ol className='flex min-h-[28rem] flex-col gap-2 p-4' aria-live='polite'>
          {shown.map((s, i) => (
            <li key={i}>{renderStep(s, awaiting && s.kind === 'confirm' ? decide : null)}</li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function bubble(text: string, mine: boolean) {
  return (
    <div className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
      <p className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${mine ? 'bg-[#d9fdd3] text-gray-900' : 'bg-white text-gray-900'}`}>{text}</p>
    </div>
  )
}

function MeetingRows({ m }: { m: DemoMeeting }) {
  const rows: [string, string][] = [['ליד', m.lead], ['מועד', `${m.date}, ${m.time}`], ['משך', m.duration], ['סוג', m.type], ['יומן', m.calendar]]
  return (
    <dl className='mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm'>
      {rows.map(([k, v]) => (
        <div key={k} className='contents'>
          <dt className='text-gray-500'>{k}</dt>
          <dd className='text-gray-900'>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function renderStep(s: Shown, decide: ((confirmed: boolean) => void) | null) {
  switch (s.kind) {
    case 'owner':
      return bubble(s.text, true)
    case 'assistant':
      return bubble(s.text, false)
    case 'pending':
      return (
        <div className='flex justify-end'>
          <p className='flex items-center gap-2 rounded-2xl bg-white/80 px-3 py-2 text-xs text-gray-600' role='status'>
            <span className='inline-block size-2 animate-pulse rounded-full bg-[#25d366] motion-reduce:animate-none' aria-hidden />
            {s.label}…
          </p>
        </div>
      )
    case 'confirm':
      return (
        <div className='flex justify-end'>
          <div className='w-[85%] rounded-2xl bg-white p-3 shadow-sm'>
            <p className='text-sm font-semibold text-gray-900'>לאשר את הפגישה?</p>
            <MeetingRows m={s.meeting} />
            {decide && (
              <div className='mt-3 flex gap-2'>
                <Btn type='button' lbl='לאשר ולקבוע' onClick={() => decide(true)} className='flex-1' />
                <Btn type='button' lbl='ביטול' variant='outline' onClick={() => decide(false)} className='flex-1' />
              </div>
            )}
          </div>
        </div>
      )
    case 'success':
      return (
        <div className='flex justify-end'>
          <div className='w-[85%] rounded-2xl border border-green-200 bg-green-50 p-3 shadow-sm'>
            <p className='text-sm font-semibold text-green-900'>הפגישה נקבעה (בהדמיה)</p>
            <MeetingRows m={s.meeting} />
            <p className='mt-2 text-xs text-green-800'>במערכת האמיתית ההודעה הזו תישלח רק אחרי שהפגישה נשמרה ואומתה.</p>
          </div>
        </div>
      )
    case 'error':
      return (
        <div className='flex justify-end'>
          <div className='w-[85%] rounded-2xl border border-red-200 bg-red-50 p-3 shadow-sm' role='alert'>
            <p className='text-sm font-semibold text-red-900'>{s.title}</p>
            <p className='mt-1 text-sm text-red-800'>{s.text}</p>
          </div>
        </div>
      )
    default:
      return null
  }
}
