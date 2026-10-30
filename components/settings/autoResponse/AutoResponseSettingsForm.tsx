'use client'

import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import { useId, useState, useTransition } from 'react'
import { Switch } from '@/lib/form'
import Icon from '@/lib/Icon'
import { updateAutoResponseSettings } from '@/actions/autoResponse/updateSettings'
import { BODY_MAX, SAVE_ERROR_KEY, saveErrorCode, toDraft, type AutoResponseFormProps as Props, type Draft, type SaveErrorCode } from './autoResponseDraft'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import AutoResponseReplyStyle from './AutoResponseReplyStyle'
import AgentPreview from './AgentPreview'
import AutoResponseTiming from './AutoResponseTiming'
import AutoResponseSaveBar from './AutoResponseSaveBar'

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
  const t = useT()
  const region = useRegionAttrs()
  const [errorCode, setError] = useState<SaveErrorCode | null>(null)
  const error = errorCode ? t(SAVE_ERROR_KEY[errorCode]) : null
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
  const fixedBodyError = errorCode === 'fixed_body_required' ? error : undefined
  const businessNameError = errorCode === 'business_name_required' ? error : undefined

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
        setError(saveErrorCode(result.reason))
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
    <div className='max-w-5xl' {...region}>
      <header className='mb-8'>
        <h1 className='title'>{t('admin.autoResponse.title')}</h1>
        <p className='mt-2 max-w-2xl text-sm leading-relaxed text-gray-600'>{t('admin.autoResponse.intro')}</p>
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
            <h2 className='text-base font-semibold text-ink'>{t('admin.autoResponse.master')}</h2>
          </div>
          <Switch
            aria-label={t('admin.autoResponse.master')}
            checked={master}
            onChange={(e) => set('master', e.target.checked)}
          />
          <p className='text-sm text-gray-500'>{master ? t('admin.autoResponse.on') : t('admin.autoResponse.off')}</p>
        </div>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>
          {master ? t('admin.autoResponse.masterOn') : t('admin.autoResponse.masterOff')}
        </p>

        {/*
          The reference draws one switch because WhatsApp is the only channel it
          knows about. The channel flag is a separate column in the DB and other
          channels are coming, so it keeps its own control rather than being
          folded into the master switch.
        */}
        {master && (
          <label className='mt-4 flex w-fit cursor-pointer items-center gap-3.5'>
            <span className='text-sm font-medium text-gray-700'>{t('admin.autoResponse.channel')}</span>
            <input
              type='checkbox'
              className='switch'
              checked={channel}
              onChange={(e) => set('channel', e.target.checked)}
            />
            <span className='text-sm text-gray-500'>{t('admin.autoResponse.channelHint')}</span>
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

          <AutoResponseTiming
            delayId={delayId}
            capId={capId}
            delaySeconds={delaySeconds}
            dailyCap={dailyCap}
            onDelaySeconds={(v) => set('delaySeconds', v)}
            onDailyCap={(v) => set('dailyCap', v)}
          />
        </>
      )}

      <AutoResponseSaveBar
        error={error}
        showError={!!error && !fixedBodyError}
        dirty={dirty}
        saved={saved}
        pending={pending}
        proLocked={proLocked}
        onCancel={cancel}
        onSave={save}
      />
    </div>
  )
}
