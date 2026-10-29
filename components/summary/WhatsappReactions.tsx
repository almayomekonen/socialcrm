'use client'

import type { ThreadReaction } from '@/lib/inbox/whatsappThreadView'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import type { Translator } from '@/lib/i18n/translate'

const HEBREW = translatorFor('he')

/**
 * `translated`: the caller's screen follows the interface language (the desktop
 * inbox). Off by default — the mobile thread is not translated yet and keeps
 * Hebrew. The emoji is the customer's and is shown as sent.
 */
function useCopy(translated: boolean): Translator {
  const ui = useT()
  return translated ? ui : HEBREW
}

const senderLabel = (t: Translator, byBusiness: boolean) =>
  byBusiness ? t('inbox.reaction.sent') : t('inbox.reaction.received')

/**
 * Reactions on a message: the emoji under the bubble it reacts to, as in
 * WhatsApp. Shared by the desktop and mobile threads.
 */
export function WhatsappReactionChips({
  reactions,
  alignEnd,
  translated = false,
}: {
  reactions: ThreadReaction[]
  alignEnd: boolean
  translated?: boolean
}) {
  const t = useCopy(translated)
  if (reactions.length === 0) return null
  return (
    <ul aria-label={t('inbox.reaction.list')} className={`-mt-1 flex gap-1 ${alignEnd ? 'justify-end' : 'justify-start'}`}>
      {reactions.map((r, i) => (
        <li key={i} className='rounded-full border border-gray-200 bg-white px-1.5 text-sm leading-6 shadow-sm'>
          <span className='sr-only'>{senderLabel(t, r.byBusiness)}: </span>
          {r.emoji}
        </li>
      ))}
    </ul>
  )
}

/**
 * A reaction whose message is not in this thread (it was sent before the
 * conversation was connected, or WhatsApp refers to it by an id we do not
 * hold). Said honestly as a reaction to an earlier message, on the sender's
 * side, never as a bubble. Worded apart from a quoted reply's "תגובה להודעה
 * קודמת": in Hebrew a reaction and a reply are both "תגובה".
 */
export function WhatsappReactionNote({
  emoji,
  byBusiness,
  alignEnd,
  translated = false,
}: {
  emoji: string
  byBusiness: boolean
  alignEnd: boolean
  translated?: boolean
}) {
  const t = useCopy(translated)
  return (
    <p className={`flex text-xs text-gray-500 ${alignEnd ? 'justify-end' : 'justify-start'}`}>
      <span>
        <span className='sr-only'>{senderLabel(t, byBusiness)}: </span>
        <span className='text-sm'>{emoji}</span> {t('inbox.reaction.onEarlier')}
      </span>
    </p>
  )
}
