'use client'

import { useState, useTransition } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Checkbox, Input } from '@/lib/form'
import { Seperator } from '@/lib/Seperator'
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
    <div className='max-w-3xl'>
      <h1 className='title'>מענה אוטומטי ללידים חדשים</h1>
      <p className='text-sm text-gray-500 mt-1 mb-4'>
        הגדירו איך SocialCRM משיב אוטומטית להודעות וואטסאפ חדשות — ואז נציג ממשיך מכאן.
      </p>

      <div className='border rounded-lg bg-white p-5 grid gap-5'>
        {/* General */}
        <section className='grid gap-3'>
          <h2 className='text-sm font-semibold text-gray-800'>כללי</h2>
          <Checkbox
            lbl='הפעלת מענה אוטומטי בעסק'
            checked={master}
            onChange={(e) => setMaster(e.target.checked)}
          />
          <p className='text-sm text-gray-500 ms-1'>כבוי — לא יישלח מענה אוטומטי בכל הערוצים.</p>
          {master && (
            <>
              <Checkbox lbl='וואטסאפ' checked={channel} onChange={(e) => setChannel(e.target.checked)} />
              <p className='text-sm text-gray-500 ms-1'>מענה אוטומטי להודעות נכנסות בוואטסאפ.</p>
            </>
          )}
        </section>

        {master && (
          <>
            <Seperator className='my-0' />

            {/* Reply */}
            <section className='grid gap-3'>
              <h2 className='text-sm font-semibold text-gray-800'>מענה</h2>
              <p className='text-sm text-gray-500'>איך SocialCRM ישיב?</p>
              <div className='grid gap-2'>
                <label className='has-checked:bg-solid/5 grid grid-cols-[16px_1fr] items-start gap-4 min-h-10 cursor-pointer bg-white px-4 py-2.5 rounded-md border border-gray-200'>
                  <input
                    type='radio'
                    name='replyMode'
                    className='size-4 accent-solid mt-0.5'
                    checked={replyMode === 'ai'}
                    onChange={() => setReplyMode('ai')}
                  />
                  <span>
                    <span className='block font-medium text-gray-800'>מענה חכם</span>
                    <span className='block text-sm text-gray-500 mt-0.5'>תשובה קצרה מותאמת להודעה, לפי ההקשר העסקי.</span>
                  </span>
                </label>
                <label className='has-checked:bg-solid/5 grid grid-cols-[16px_1fr] items-start gap-4 min-h-10 cursor-pointer bg-white px-4 py-2.5 rounded-md border border-gray-200'>
                  <input
                    type='radio'
                    name='replyMode'
                    className='size-4 accent-solid mt-0.5'
                    checked={replyMode === 'fixed'}
                    onChange={() => setReplyMode('fixed')}
                  />
                  <span>
                    <span className='block font-medium text-gray-800'>הודעה קבועה</span>
                    <span className='block text-sm text-gray-500 mt-0.5'>אותו נוסח בכל פעם — אפשר לכלול שם פרטי.</span>
                  </span>
                </label>
              </div>

              {replyMode === 'ai' ? (
                <Input
                  as='textarea'
                  lbl='הקשר עסקי לרקע'
                  info='לא לציטוט כעובדה'
                  value={guidance}
                  onChange={(e) => setGuidance(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  required={false}
                  placeholder='למשל: סטודיו לעיצוב פנים, מתמחים בדירות'
                />
              ) : (
                <div className='grid gap-1'>
                  <Input
                    as='textarea'
                    lbl='הודעה קבועה'
                    value={fixedBody}
                    onChange={(e) => setFixedBody(e.target.value)}
                    rows={4}
                    maxLength={1000}
                    required={false}
                    error={error === 'יש להזין הודעה קבועה' ? error : undefined}
                    placeholder={'שלום {{firstName}}, תודה שפנית אלינו! קיבלנו את ההודעה ונחזור אליך בהקדם.'}
                  />
                  <p className='text-xs text-gray-500 ms-1'>משתנה זמין: {'{{firstName}}'}</p>
                </div>
              )}
            </section>

            <Seperator className='my-0' />

            {/* Behavior */}
            <section className='grid gap-3'>
              <h2 className='text-sm font-semibold text-gray-800'>התנהגות</h2>
              <Input
                type='number'
                lbl='השהיה לפני שליחה'
                info='שניות'
                min={0}
                max={3600}
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(e.target.value)}
                required={false}
                className='max-w-40'
              />
              <p className='text-sm text-gray-500 ms-1 -mt-1'>0 = שליחה מיידית אחרי ההודעה הנכנסת.</p>
              <Input
                type='number'
                lbl='מגבלת מענים ליום'
                min={0}
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
                required={false}
                className='max-w-40'
              />
            </section>
          </>
        )}
      </div>

      <div className='mt-4 grid gap-2'>
        <Btn
          lbl={pending ? 'שומר…' : 'שמור שינויים'}
          icon={pending ? 'spinner' : 'floppy-disk'}
          iconClassName={pending ? 'animate-spin' : undefined}
          disabled={pending}
          className='w-full'
          onClick={save}
        />
        {saved && <p className='text-sm text-green-600 ms-1'>השינויים נשמרו</p>}
        {error && error !== 'יש להזין הודעה קבועה' && (
          <p className='text-sm text-red-600 ms-1' role='alert'>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
