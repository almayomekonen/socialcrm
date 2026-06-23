'use client'

import { useState, useTransition } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { updateAutoResponseSettings } from '@/actions/autoResponse/updateSettings'

type Props = {
  masterEnabled: boolean
  channelEnabled: boolean
  dailyCap: number
  guidance: string | null
}

/**
 * Workspace control for the Instant Response Engine (Phase 1, WhatsApp). The
 * master switch gates everything; the channel card configures WhatsApp. Framed
 * as help, not autopilot — one short greeting + question, then a rep continues.
 */
export default function AutoResponseSettingsForm(initial: Props) {
  const [master, setMaster] = useState(initial.masterEnabled)
  const [channel, setChannel] = useState(initial.channelEnabled)
  const [dailyCap, setDailyCap] = useState(String(initial.dailyCap))
  const [guidance, setGuidance] = useState(initial.guidance ?? '')
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  function save() {
    setSaved(false)
    startTransition(async () => {
      await updateAutoResponseSettings({
        masterEnabled: master,
        channelEnabled: channel,
        dailyCap: Number(dailyCap) || 0,
        guidance: guidance.trim() || null,
      })
      setSaved(true)
    })
  }

  return (
    <div className='max-w-xl grid gap-6'>
      <div>
        <h1 className='title'>מענה אוטומטי ללידים חדשים</h1>
        <p className='text-sm text-gray-400 mt-1'>
          כשליד חדש כותב בוואטסאפ, נשלחת אליו ברכת פתיחה קצרה ושאלה אחת — ונציג ממשיך מכאן. אף פעם לא נמסור מחיר,
          זמינות או התחייבות.
        </p>
      </div>

      <label className='flex items-center gap-3'>
        <input type='checkbox' checked={master} onChange={(e) => setMaster(e.target.checked)} />
        <span className='font-semibold'>הפעלת מענה אוטומטי בעסק</span>
      </label>

      {master && (
        <div className='grid gap-4 border border-white/10 rounded-lg p-4'>
          <label className='flex items-center gap-3'>
            <input type='checkbox' checked={channel} onChange={(e) => setChannel(e.target.checked)} />
            <span className='font-semibold'>וואטסאפ</span>
          </label>

          <label className='grid gap-1'>
            <span className='text-sm text-gray-400'>מגבלת מענים ליום</span>
            <input
              type='number'
              min={0}
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
              className='bg-transparent border border-white/15 rounded px-2 py-1 w-32'
            />
          </label>

          <label className='grid gap-1'>
            <span className='text-sm text-gray-400'>הקשר עסקי לרקע (לא לציטוט כעובדה)</span>
            <textarea
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              rows={3}
              maxLength={1000}
              className='bg-transparent border border-white/15 rounded px-2 py-1'
              placeholder='למשל: סטודיו לעיצוב פנים, מתמחים בדירות'
            />
          </label>
        </div>
      )}

      <div className='flex items-center gap-3'>
        <Btn onClick={save} disabled={pending}>
          {pending ? 'שומר…' : 'שמור שינויים'}
        </Btn>
        {saved && <span className='text-sm text-green-400'>השינויים נשמרו</span>}
      </div>
    </div>
  )
}
