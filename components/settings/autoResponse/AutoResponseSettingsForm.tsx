'use client'

import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { useId, useState, useTransition } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Switch } from '@/lib/form'
import Icon from '@/lib/Icon'
import { updateAutoResponseSettings } from '@/actions/autoResponse/updateSettings'
import type { AutoResponseReplyMode } from '@/db/autoResponseSettings'
import AutoResponseReplyStyle from './AutoResponseReplyStyle'
import AgentPreview from './AgentPreview'

type Props = {
  masterEnabled: boolean
  channelEnabled: boolean
  dailyCap: number
  guidance: string | null
  agentInstructions: string | null
  replyMode: AutoResponseReplyMode
  fixedBody: string | null
  delaySeconds: number
  /** From the account. Empty ⇒ the form asks for it inline. */
  businessName: string
}

type Draft = {
  master: boolean
  channel: boolean
  dailyCap: string
  guidance: string
  agentInstructions: string
  replyMode: AutoResponseReplyMode
  fixedBody: string
  delaySeconds: string
  businessName: string
}

const BODY_MAX = 1000

function toDraft(p: Props): Draft {
  return {
    master: p.masterEnabled,
    channel: p.channelEnabled,
    dailyCap: String(p.dailyCap),
    guidance: p.guidance ?? '',
    agentInstructions: p.agentInstructions ?? '',
    replyMode: p.replyMode,
    fixedBody: p.fixedBody ?? '',
    delaySeconds: String(p.delaySeconds),
    businessName: p.businessName ?? '',
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
  const instructionsId = useId()
  const nameId = useId()
  const delayId = useId()
  const capId = useId()

  const { master, channel, dailyCap, guidance, agentInstructions, replyMode, fixedBody, delaySeconds, businessName } =
    draft
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [unsupported, setUnsupported] = useState<string[]>([])
  const [savedDescription, setSavedDescription] = useState(initial.guidance ?? '')
  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== baseline[k])
  const fixedBodyError = error === 'יש להזין הודעה קבועה' ? error : undefined
  const businessNameError = error === 'צריך שם עסק כדי שהסוכן יוכל לפתוח שיחה' ? error : undefined

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

  /**
   * TIER 2. The configuration stays visible so an expired customer can see how
   * their auto responder is set up. Saving is gated because it governs outbound
   * WhatsApp replies, which cost money to send.
   */
  const proLocked = useAccessDenied()

  function save() {
    setSaved(false)
    setError(null)
    startTransition(async () => {
      const result = await updateAutoResponseSettings({
        masterEnabled: master,
        channelEnabled: channel,
        dailyCap: Number(dailyCap) || 0,
        guidance: guidance.trim() || null,
        agentInstructions: agentInstructions.trim() || null,
        businessName: businessName.trim() || null,
        replyMode,
        fixedBody: fixedBody.trim() || null,
        delaySeconds: Number(delaySeconds) || 0,
      })
      if (result.ok === false) {
        // `profile_derivation_failed` is the recoverable one: everything the
        // owner typed IS saved and the agent still works from their words —
        // only the structured view is missing, and saving again retries it.
        const copy: Record<string, string> = {
          fixed_body_required: 'יש להזין הודעה קבועה',
          business_name_required: 'צריך שם עסק כדי שהסוכן יוכל לפתוח שיחה',
          profile_derivation_failed:
            'הטקסט נשמר, אבל לא הצלחנו לעבד אותו כרגע. הסוכן עדיין עובד לפי מה שכתבתם. אפשר לשמור שוב כדי לנסות.',
        }
        setError(copy[result.reason] ?? 'לא ניתן לשמור')
        if (result.reason === 'profile_derivation_failed') {
          setBaseline(draft)
          setSavedDescription(guidance)
        }
        return
      }
      setBaseline(draft)
      setSavedDescription(guidance)
      setSaved(true)
      setUnsupported(result.unsupportedRequests)
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
          <AutoResponseReplyStyle
            replyMode={replyMode}
            onReplyMode={(m) => set('replyMode', m)}
            guidance={guidance}
            onGuidance={(v) => set('guidance', v)}
            agentInstructions={agentInstructions}
            onAgentInstructions={(v) => set('agentInstructions', v)}
            advancedOpen={advancedOpen}
            onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
            fixedBody={fixedBody}
            onFixedBody={(v) => set('fixedBody', v)}
            fixedBodyError={fixedBodyError}
            businessName={businessName}
            onBusinessName={(v) => set('businessName', v)}
            needsBusinessName={!initial.businessName}
            businessNameError={businessNameError}
            unsupported={unsupported}
            bodyId={bodyId}
            instructionsId={instructionsId}
            nameId={nameId}
            maxLength={BODY_MAX}
          />

          {replyMode === 'ai' && (
            <AgentPreview
              draftDescription={guidance}
              draftAgentInstructions={agentInstructions}
              savedDescription={savedDescription}
              businessName={businessName || initial.businessName}
            />
          )}

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

        {proLocked ? (
          <SubscriptionExpiredState
            mode='inline'
            source='auto_response_save'
            feature='חידוש המנוי מחזיר את המענה האוטומטי'
          />
        ) : (
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
        )}
      </div>
    </div>
  )
}
