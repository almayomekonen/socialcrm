'use client'

import { useState, useTransition } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { updateAutoResponseSettings } from '@/actions/autoResponse/updateSettings'
import type { AutoResponseReplyMode } from '@/db/autoResponseSettings'

type Props = {
  masterEnabled: boolean
  channelEnabled: boolean
  dailyCap: number
  guidance: string | null
  replyMode: AutoResponseReplyMode
  fixedBody: string | null
  delaySeconds: number
}

/**
 * Workspace control for WhatsApp Auto Response. Master switch gates everything;
 * channel card configures WhatsApp. Owner chooses how the reply is produced:
 * smart AI or a fixed custom message (one mode at a time).
 */
export default function AutoResponseSettingsForm(initial: Props) {
  const [master, setMaster] = useState(initial.masterEnabled)
  const [channel, setChannel] = useState(initial.channelEnabled)
  const [dailyCap, setDailyCap] = useState(String(initial.dailyCap))
  const [guidance, setGuidance] = useState(initial.guidance ?? '')
  const [replyMode, setReplyMode] = useState<AutoResponseReplyMode>(initial.replyMode)
  const [fixedBody, setFixedBody] = useState(initial.fixedBody ?? '')
  const [delaySeconds, setDelaySeconds] = useState(String(initial.delaySeconds))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    setSaved(false)
    setError(null)
    startTransition(async () => {
      const result = await updateAutoResponseSettings({
        masterEnabled: master,
        channelEnabled: channel,
        dailyCap: Number(dailyCap) || 0,
        guidance: guidance.trim() || null,
        replyMode,
        fixedBody: fixedBody.trim() || null,
        delaySeconds: Number(delaySeconds) || 0,
      })
      if (result.ok === false) {
        setError(result.reason === 'fixed_body_required' ? 'יש להזין הודעה קבועה' : 'לא ניתן לשמור')
        return
      }
      setSaved(true)
    })
  }

  return (
    <div className='max-w-xl grid gap-6'>
      <div>
        <h1 className='title'>מענה אוטומטי ללידים חדשים</h1>
        <p className='text-sm text-gray-400 mt-1'>
          כשמישהו כותב בוואטסאפ, SocialCRM יכול להשיב אוטומטית — ואז נציג ממשיך מכאן.
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

          <fieldset className='grid gap-2'>
            <legend className='text-sm text-gray-400 mb-1'>איך SocialCRM ישיב?</legend>
            <label className='flex items-center gap-3'>
              <input
                type='radio'
                name='replyMode'
                checked={replyMode === 'ai'}
                onChange={() => setReplyMode('ai')}
              />
              <span>מענה חכם</span>
            </label>
            <label className='flex items-center gap-3'>
              <input
                type='radio'
                name='replyMode'
                checked={replyMode === 'fixed'}
                onChange={() => setReplyMode('fixed')}
              />
              <span>הודעה קבועה</span>
            </label>
          </fieldset>

          {replyMode === 'ai' ? (
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
          ) : (
            <label className='grid gap-1'>
              <span className='text-sm text-gray-400'>הודעה קבועה</span>
              <textarea
                value={fixedBody}
                onChange={(e) => setFixedBody(e.target.value)}
                rows={4}
                maxLength={1000}
                className='bg-transparent border border-white/15 rounded px-2 py-1'
                placeholder={'שלום {{firstName}}, תודה שפנית אלינו! קיבלנו את ההודעה ונחזור אליך בהקדם.'}
              />
              <span className='text-xs text-gray-500'>משתנה זמין: {'{{firstName}}'}</span>
            </label>
          )}

          <label className='grid gap-1'>
            <span className='text-sm text-gray-400'>השהיה לפני שליחה (שניות)</span>
            <input
              type='number'
              min={0}
              max={3600}
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(e.target.value)}
              className='bg-transparent border border-white/15 rounded px-2 py-1 w-32'
            />
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
        </div>
      )}

      <div className='flex items-center gap-3'>
        <Btn onClick={save} disabled={pending}>
          {pending ? 'שומר…' : 'שמור שינויים'}
        </Btn>
        {saved && <span className='text-sm text-green-400'>השינויים נשמרו</span>}
        {error && <span className='text-sm text-red-400'>{error}</span>}
      </div>
    </div>
  )
}
