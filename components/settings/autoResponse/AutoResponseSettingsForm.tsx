'use client'

import { useId, useState, useTransition } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Switch } from '@/lib/form'
import Icon from '@/lib/Icon'
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

type Draft = {
  master: boolean
  channel: boolean
  dailyCap: string
  guidance: string
  replyMode: AutoResponseReplyMode
  fixedBody: string
  delaySeconds: string
}

const BODY_MAX = 1000

function toDraft(p: Props): Draft {
  return {
    master: p.masterEnabled,
    channel: p.channelEnabled,
    dailyCap: String(p.dailyCap),
    guidance: p.guidance ?? '',
    replyMode: p.replyMode,
    fixedBody: p.fixedBody ?? '',
    delaySeconds: String(p.delaySeconds),
  }
}

/**
 * Workspace control for WhatsApp Auto Response. Master switch gates everything;
 * the owner chooses how the reply is produced — smart AI or a fixed custom
 * message, one mode at a time — and how fast it goes out.
 *
 * The page sits directly on the canvas: no card wraps a section, because the
 * cards were reading as four unrelated widgets when this is one form. Groups are
 * told apart by a hairline and 44px of air (22px either side of the rule), which
 * is the rhythm the 3b reference draws.
 *
 * The free-text box belongs to whichever reply mode is selected, so it renders in
 * the SAME two-column grid as the options and starts in the selected option's
 * column. That is what ties the text to its radio without drawing a container
 * around them.
 */
export default function AutoResponseSettingsForm(initial: Props) {
  const [baseline, setBaseline] = useState<Draft>(() => toDraft(initial))
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const bodyId = useId()
  const delayId = useId()
  const capId = useId()

  const { master, channel, dailyCap, guidance, replyMode, fixedBody, delaySeconds } = draft
  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== baseline[k])
  const fixedBodyError = error === 'יש להזין הודעה קבועה' ? error : undefined

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    setSaved(false)
    setError(null)
  }

  function cancel() {
    setDraft(baseline)
    setSaved(false)
    setError(null)
  }

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
      setBaseline(draft)
      setSaved(true)
    })
  }

  return (
    <div className='max-w-5xl'>
      <header className='mb-8'>
        <h1 className='title'>מענה אוטומטי</h1>
        <p className='mt-2 max-w-2xl text-sm leading-relaxed text-gray-600'>
          ליד שכותב בוואטסאפ מקבל תשובה תוך שניות, גם כשאתם לא ליד המסך. אתם ממשיכים את השיחה משם.
        </p>
      </header>

      <section>
        <div className='flex items-center gap-3.5'>
          {/*
            The brand mark, not a chat bubble: the glyph is the whole point of
            putting it here, so it uses the same `whatsapp` icon and the same
            official #25D366 the אינטגרציות rows use (see integrations/brandColors).
            Icons render as CSS masks, so the colour is a `bg-*` class.
          */}
          <div className='flex items-center gap-2.5'>
            <Icon type='reg' name='whatsapp' className='size-4.5 bg-[#25D366]' />
            <h2 className='text-base font-semibold text-ink'>מענה אוטומטי בוואטסאפ</h2>
          </div>
          <Switch
            aria-label='מענה אוטומטי בוואטסאפ'
            checked={master}
            onChange={(e) => set('master', e.target.checked)}
          />
          <p className='text-sm text-gray-500'>{master ? 'מופעל' : 'כבוי'}</p>
        </div>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>
          {master ? 'כל הודעה נכנסת מקבלת מענה לפי ההגדרות למטה.' : 'כרגע לא נשלח מענה בשום ערוץ.'}
        </p>

        {/*
          The reference draws one switch because WhatsApp is the only channel it
          knows about. The channel flag is a separate column in the DB and other
          channels are coming, so it keeps its own control rather than being
          folded into the master switch.
        */}
        {master && (
          <label className='mt-4 flex w-fit cursor-pointer items-center gap-3.5'>
            <span className='text-sm font-medium text-gray-700'>וואטסאפ</span>
            <input
              type='checkbox'
              className='switch'
              checked={channel}
              onChange={(e) => set('channel', e.target.checked)}
            />
            <span className='text-sm text-gray-500'>הערוץ שבו נשלח המענה. ערוצים נוספים יתווספו בהמשך.</span>
          </label>
        )}
      </section>

      {master && (
        <>
          <section className='mt-5.5 border-t border-gray-200 pt-5.5'>
            <h2 className='text-base font-semibold text-ink'>סגנון התשובה</h2>
            <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>בחרו איך SocialCRM מנסחת את המענה.</p>

            <div className='mt-4 grid gap-x-3 gap-y-4 sm:grid-cols-2'>
              <label className='flex cursor-pointer flex-col gap-1.5 rounded-lg border border-gray-200 bg-white px-4.5 py-3.5 transition-colors hover:border-gray-300 has-checked:border-solid has-checked:ring-1 has-checked:ring-solid'>
                <span className='flex items-center justify-between gap-2.5'>
                  <span className='text-md font-semibold text-ink'>מענה חכם</span>
                  <input
                    type='radio'
                    name='replyMode'
                    className='size-4 accent-solid'
                    checked={replyMode === 'ai'}
                    onChange={() => set('replyMode', 'ai')}
                  />
                </span>
                <span className='text-sm leading-relaxed text-gray-600'>תשובה קצרה שמתאימה להודעה שהתקבלה</span>
              </label>

              <label className='flex cursor-pointer flex-col gap-1.5 rounded-lg border border-gray-200 bg-white px-4.5 py-3.5 transition-colors hover:border-gray-300 has-checked:border-solid has-checked:ring-1 has-checked:ring-solid'>
                <span className='flex items-center justify-between gap-2.5'>
                  <span className='text-md font-semibold text-ink'>הודעה קבועה</span>
                  <input
                    type='radio'
                    name='replyMode'
                    className='size-4 accent-solid'
                    checked={replyMode === 'fixed'}
                    onChange={() => set('replyMode', 'fixed')}
                  />
                </span>
                <span className='text-sm leading-relaxed text-gray-600'>אותו נוסח בכל פעם, עם שם הליד</span>
              </label>

              <div className={replyMode === 'ai' ? 'sm:col-start-1' : 'sm:col-start-2'}>
                <div className='flex items-baseline gap-2.5'>
                  <label htmlFor={bodyId} className='text-sm font-semibold text-gray-700'>
                    {replyMode === 'ai' ? 'על העסק שלכם' : 'ההודעה שתישלח'}
                  </label>
                  <p className='text-xs text-gray-500'>
                    {replyMode === 'ai' ? 'המענה החכם משתמש בזה כדי לדעת מי אתם' : 'אפשר לשלב {{firstName}}'}
                  </p>
                </div>

                <div className='mt-3.5 rounded-md border border-gray-200 bg-white focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-primary aria-invalid:border-red-500 aria-invalid:focus-within:outline-red-200'>
                  <textarea
                    id={bodyId}
                    rows={3}
                    maxLength={BODY_MAX}
                    className='block w-full resize-none bg-transparent px-4 pt-3.5 text-sm leading-relaxed outline-none'
                    value={replyMode === 'ai' ? guidance : fixedBody}
                    onChange={(e) => set(replyMode === 'ai' ? 'guidance' : 'fixedBody', e.target.value)}
                    aria-invalid={replyMode === 'fixed' && !!fixedBodyError}
                    aria-describedby={fixedBodyError ? `${bodyId}-error` : undefined}
                    placeholder={
                      replyMode === 'ai'
                        ? 'למשל: סטודיו לעיצוב פנים, מתמחים בדירות'
                        : 'שלום {{firstName}}, תודה שפנית אלינו! קיבלנו את ההודעה ונחזור אליך בהקדם.'
                    }
                  />
                  <div className='mx-4 flex items-center justify-between border-t border-gray-100 py-2 text-xs text-gray-500'>
                    <span>{replyMode === 'ai' ? 'אפשר לעדכן בכל רגע' : 'השם ייכנס אוטומטית'}</span>
                    <span>
                      {(replyMode === 'ai' ? guidance : fixedBody).length} / {BODY_MAX}
                    </span>
                  </div>
                </div>

                {fixedBodyError && replyMode === 'fixed' && (
                  <p id={`${bodyId}-error`} role='alert' className='mt-1 text-sm text-red-600'>
                    {fixedBodyError}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className='mt-5.5 border-t border-gray-200 pt-5.5'>
            <h2 className='text-base font-semibold text-ink'>תזמון ומגבלות</h2>
            <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>שליטה בקצב, כדי שהמענה יישאר טבעי.</p>

            {/*
              One control, not two: the pair shares a single rounded outline and is
              split by a 1px rule, so the ceiling reads as part of the same pacing
              decision as the delay. The 1px is the container's own background
              showing through `gap-px`.
            */}
            <div className='mt-4 max-w-100'>
              <div className='grid grid-cols-2 gap-px'>
                <label htmlFor={delayId} className='ps-3.25 text-sm text-gray-700'>
                  המתנה לפני שליחה
                </label>
                <label htmlFor={capId} className='ps-3.25 text-sm text-gray-700'>
                  מקסימום מענים ביום
                </label>
              </div>

              <div className='mt-1.75 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-gray-200 bg-gray-200 focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-primary'>
                <div className='flex h-10 items-center gap-2 bg-white ps-3.25 pe-3.25'>
                  <input
                    id={delayId}
                    type='number'
                    min={0}
                    max={3600}
                    className='w-full min-w-0 bg-transparent text-md outline-none'
                    value={delaySeconds}
                    onChange={(e) => set('delaySeconds', e.target.value)}
                  />
                  <span className='text-sm text-gray-500'>שניות</span>
                </div>
                <div className='flex h-10 items-center gap-2 bg-white ps-3.25 pe-3.25'>
                  <input
                    id={capId}
                    type='number'
                    min={0}
                    className='w-full min-w-0 bg-transparent text-md outline-none'
                    value={dailyCap}
                    onChange={(e) => set('dailyCap', e.target.value)}
                  />
                  <span className='text-sm text-gray-500'>הודעות</span>
                </div>
              </div>

              <div className='mt-1.75 grid grid-cols-2 gap-px'>
                <p className='ps-3.25 text-xs text-gray-500'>אפס שולח מיד.</p>
                <p className='ps-3.25 text-xs text-gray-500'>תקרה יומית לכל העסק.</p>
              </div>
            </div>
          </section>
        </>
      )}

      <div className='mt-5.5 flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 pt-5.5'>
        <div className='flex items-center gap-2.5'>
          {error && !fixedBodyError && (
            <p className='text-sm text-red-600' role='alert'>
              {error}
            </p>
          )}
          {!error && dirty && (
            <>
              <span className='size-1.25 rounded-full bg-warning' />
              <p className='text-sm text-gray-500'>יש שינויים שלא נשמרו</p>
            </>
          )}
          {!error && !dirty && saved && <p className='text-sm text-gray-500'>השינויים נשמרו</p>}
        </div>

        <div className='flex items-center gap-2.5'>
          <Btn variant='outline' lbl='ביטול' disabled={!dirty || pending} onClick={cancel} />
          <Btn
            lbl={pending ? 'שומר…' : 'שמור שינויים'}
            icon={pending ? 'spinner' : undefined}
            iconClassName={pending ? 'animate-spin' : undefined}
            disabled={pending}
            onClick={save}
          />
        </div>
      </div>
    </div>
  )
}
