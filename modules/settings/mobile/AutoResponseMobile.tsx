import Icon from '@/lib/Icon'
import { isAdmin } from '@/types/roles'
import type { Roles } from '@/types/roles'
import { getMasterEnabled, getChannelSettings } from '@/db/autoResponseSettings'
import AutoResponseToggle from './AutoResponseToggle'
import { regionAttrs, untranslatedAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import ResponderSelector from '@/components/settings/autoResponse/ResponderSelector'
import { resolveResponderChoice } from '@/lib/inbox/autoresponse/responderChoice'
import { canUseWhatsappQuestionnaire } from '@/lib/flags/whatsappQuestionnaireFlags'
import { parseQuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'

/**
 * מענה אוטומטי, on a phone: is it on, what does it say, and how to stop it.
 *
 * NOT THE DESKTOP FORM. That form owns seven fields — daily cap, delay, guidance,
 * reply mode, fixed body, channel and master — because configuring an automatic
 * responder is desk work. The phone gets the one thing that is genuinely urgent
 * away from a computer: the ability to see that a machine is messaging customers
 * and to stop it. Everything else is read-only here and stated to live on the
 * computer, so this screen can never drift into a second settings surface.
 *
 * Server Component: two existing reads (`getMasterEnabled`, `getChannelSettings`),
 * no new query, no polling, no cache layer. The only mutation on this screen is
 * the master switch, through its own narrow action.
 *
 * ADMIN ONLY, TWICE. The `(admin_settings)` layout already blocks non-ADMIN
 * before this renders, and the server action checks again on every call. The
 * check below is the third: it keeps the guarantee attached to the component
 * itself, so mounting it from a future route cannot quietly drop the gate.
 */
export default async function AutoResponseMobile({
  agencyId,
  role,
  locale = 'he',
}: {
  agencyId: number
  role: Roles
  /** The interface language, resolved once by the page (Hebrew by default). */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  if (!isAdmin(role)) {
    return (
      <div className='px-4 py-10 text-center' {...regionAttrs(locale)}>
        <p className='text-sm text-gray-500'>{t('admin.page.denied')}</p>
      </div>
    )
  }

  const [master, channel] = await Promise.all([getMasterEnabled(agencyId), getChannelSettings(agencyId, 'whatsapp')])

  const replyMode = channel?.replyMode ?? 'ai'
  const fixedBody = channel?.fixedBody?.trim() || null
  const guidance = channel?.guidance?.trim() || null
  // Master on but the WhatsApp channel off means nothing is actually sent.
  // Saying "פעיל" then would be a false statement about the business, so the
  // gap is named here rather than papered over (care-charter Laws 1-3).
  const channelOff = master && !(channel?.enabled ?? false)
  // The message shown below is the AI agent's. While a questionnaire answers,
  // it is not what the customer receives, and the phone must not claim it is.
  const questionnaire = channel?.responder === 'questionnaire'

  return (
    <div className='flex flex-col gap-4 px-4 pb-8 pt-3' {...regionAttrs(locale)}>
      <AutoResponseToggle initialEnabled={master} />

      {channelOff && (
        <p className='rounded-xl border border-warning-border bg-warning-bg px-3.5 py-3 text-[13px] leading-relaxed text-warning-text'>
          {t('admin.mobile.autoResponse.channelOff')}
        </p>
      )}

      {questionnaire && (
        <p className='rounded-xl border border-warning-border bg-warning-bg px-3.5 py-3 text-[13px] leading-relaxed text-warning-text'>
          {t('admin.mobile.autoResponse.questionnaire')}
        </p>
      )}

      {/* Which method answers, read-only: switching asks for a confirmation and is desk work. */}
      {channel && (
        <ResponderSelector
          readOnly
          choice={resolveResponderChoice({
            responder: channel.responder,
            mode: channel.mode,
            replyMode: channel.replyMode,
            questionnaireAllowed: canUseWhatsappQuestionnaire(agencyId),
            questionnairePublished: parseQuestionnaireDefinition(channel.questionnaire ?? null).ok,
          })}
        />
      )}

      <section aria-labelledby='auto-response-message' className='flex flex-col gap-2'>
        <h2 id='auto-response-message' className='px-1 text-sm font-semibold text-gray-500'>
          {t('admin.mobile.autoResponse.sent')}
        </h2>

        <div className='rounded-xl border border-gray-200 bg-white px-3.5 py-3'>
          {replyMode === 'fixed' ? (
            fixedBody ? (
              /* The stored text, verbatim. Nothing is generated or previewed
                 here — this is the exact נוסח the desktop form saved. */
              <p className='whitespace-pre-wrap text-[15px] leading-relaxed text-ink' {...untranslatedAttrs(locale)}>
                {fixedBody}
              </p>
            ) : (
              <p className='text-[15px] leading-relaxed text-gray-500'>{t('admin.mobile.autoResponse.fixedNotSet')}</p>
            )
          ) : (
            <>
              <div className='flex items-center gap-2'>
                <Icon type='sol' name='sparkles' className='size-4 bg-primary' />
                <p className='text-[15px] font-medium text-ink'>{t('admin.autoResponse.style.ai')}</p>
              </div>
              <p className='mt-1 text-[13px] leading-relaxed text-gray-500'>
                {t('admin.mobile.autoResponse.smartExplain')}
              </p>
              {guidance && (
                <div className='mt-3 border-t border-gray-100 pt-3' {...untranslatedAttrs(locale)}>
                  <p className='text-[12px] font-medium text-gray-500'>על העסק שלכם</p>
                  <p className='mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-ink'>{guidance}</p>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* The handoff sentence, matching the copy contract the rest of the
          mobile workspace uses for desk work (lib/mobile/desktopOnlyRoutes.ts):
          state where it lives, never apologise, never frame it as missing. */}
      <p className='px-1 text-[13px] leading-relaxed text-gray-500'>
        {t('admin.mobile.autoResponse.advanced')}
      </p>
    </div>
  )
}
