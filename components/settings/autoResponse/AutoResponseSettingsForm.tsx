'use client'

import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import { useId, useState } from 'react'
import { Switch } from '@/lib/form'
import Icon from '@/lib/Icon'
import { BODY_MAX, type AutoResponseFormProps as Props } from './autoResponseDraft'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import AutoResponseReplyStyle from './AutoResponseReplyStyle'
import { AgentPreviewLauncher, AgentPreviewPanel, useAgentPreview } from './AgentPreview'
import AutoResponseTiming from './AutoResponseTiming'
import AutoResponseSaveBar from './AutoResponseSaveBar'
import AutoResponseAgentProfile from './AutoResponseAgentProfile'
import { useAutoResponseForm } from './useAutoResponseForm'

/**
 * Workspace control for WhatsApp Auto Response. Master switch gates everything;
 * the owner chooses how the reply is produced and how fast it goes out.
 *
 * The page sits directly on the canvas: no card wraps a section, because the
 * cards were reading as four unrelated widgets when this is one form. Groups are
 * told apart by a hairline and 44px of air. Every section and field spans the
 * same content column.
 *
 * TWO COLUMNS on a wide screen while the Smart Agent is the reply style: the form
 * on the start side, the test chat sticky on the end side, so the owner sees the
 * agent answer while editing it. Narrower, the chat is one button in the flow.
 *
 * State and the save live in `useAutoResponseForm`; the save bar appears only
 * while there is something to save.
 */
export default function AutoResponseSettingsForm(initial: Props) {
  const t = useT()
  const region = useRegionAttrs()
  const form = useAutoResponseForm(initial)
  const { draft, baseline, set, profile, setProfile, showProfile, dirty, errorCode, error, pending, unsupported, savedDescription } = form
  const agentSettingsVisible = initial.agentSettingsVisible !== false
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const bodyId = useId()
  const instructionsId = useId()
  const nameId = useId()
  const delayId = useId()
  const capId = useId()

  const { master, channel, dailyCap, guidance, agentInstructions, replyMode, fixedBody, delaySeconds, businessName } = draft
  const fixedBodyError = errorCode === 'fixed_body_required' ? (error ?? undefined) : undefined
  const businessNameError = errorCode === 'business_name_required' ? (error ?? undefined) : undefined

  /**
   * TIER 2. The configuration stays visible so an expired customer can see how
   * their auto responder is set up. Saving is gated because it governs outbound
   * WhatsApp replies, which cost money to send.
   */
  const proLocked = useAccessDenied()

  const showPreview = master && agentSettingsVisible && replyMode === 'ai'
  const preview = useAgentPreview({
    draftDescription: guidance,
    draftAgentInstructions: agentInstructions,
    savedDescription,
    businessName: businessName || initial.businessName,
  })

  return (
    <div className='max-w-5xl' {...region}>
      <header className='mb-8 max-w-2xl'>
        <h1 className='title'>{t('admin.autoResponse.title')}</h1>
        <p className='mt-2 text-sm leading-relaxed text-gray-600'>{t('admin.autoResponse.intro')}</p>
      </header>

      <div className={showPreview ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-x-10' : undefined}>
        <div className='min-w-0 max-w-2xl'>
          <section>
            <div className='flex items-center gap-3.5'>
              {/*
                The brand mark, not a chat bubble: the same `whatsapp` icon and
                the same official #25D366 the אינטגרציות rows use. Icons render as
                CSS masks, so the colour is a `bg-*` class.
              */}
              <div className='flex items-center gap-2.5'>
                <Icon type='reg' name='whatsapp' className='size-4.5 bg-[#25D366]' />
                <h2 className='text-base font-semibold text-ink'>{t('admin.autoResponse.master')}</h2>
              </div>
              <Switch aria-label={t('admin.autoResponse.master')} checked={master} onChange={(e) => set('master', e.target.checked)} />
              <p className='text-sm text-gray-500'>{master ? t('admin.autoResponse.on') : t('admin.autoResponse.off')}</p>
            </div>
            <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>
              {master ? t('admin.autoResponse.masterOn') : t('admin.autoResponse.masterOff')}
            </p>

            {/*
              The channel flag is a separate DB column and other channels are
              coming, so it keeps its own control. While WhatsApp is the only
              channel and it is ON, the control only repeats the master switch,
              so it is hidden. A stored OFF keeps it visible: hiding it then
              would leave auto-reply silently off with no way back on.
            */}
            {master && !baseline.channel && (
              <label className='mt-4 flex w-fit cursor-pointer items-center gap-3.5'>
                <span className='text-sm font-medium text-gray-700'>{t('admin.autoResponse.channel')}</span>
                <input type='checkbox' className='switch' checked={channel} onChange={(e) => set('channel', e.target.checked)} />
                <span className='text-sm text-gray-500'>{t('admin.autoResponse.channelHint')}</span>
              </label>
            )}
          </section>

          {initial.responderSlot}

          {master && (
            <>
              {!agentSettingsVisible && (
                <p className='mt-8 text-sm leading-relaxed text-gray-600'>{t('admin.autoResponse.responder.agentHidden')}</p>
              )}
              {agentSettingsVisible && (
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
              )}

              {showPreview && (
                <div className='mt-5.5 xl:hidden'>
                  <AgentPreviewLauncher preview={preview} />
                </div>
              )}

              {agentSettingsVisible && replyMode === 'ai' && showProfile && <AutoResponseAgentProfile value={profile} onChange={setProfile} />}

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
            pending={pending}
            proLocked={proLocked}
            onCancel={form.cancel}
            onSave={form.save}
          />
        </div>

        {showPreview && <AgentPreviewPanel preview={preview} />}
      </div>
    </div>
  )
}
