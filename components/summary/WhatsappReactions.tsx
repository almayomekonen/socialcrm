import type { ThreadReaction } from '@/lib/inbox/whatsappThreadView'

const senderLabel = (byBusiness: boolean) => (byBusiness ? 'תגובה שנשלחה' : 'תגובה נכנסת')

/**
 * Reactions on a message: the emoji under the bubble it reacts to, as in
 * WhatsApp. Shared by the desktop and mobile threads.
 */
export function WhatsappReactionChips({ reactions, alignEnd }: { reactions: ThreadReaction[]; alignEnd: boolean }) {
  if (reactions.length === 0) return null
  return (
    <ul aria-label='תגובות להודעה' className={`-mt-1 flex gap-1 ${alignEnd ? 'justify-end' : 'justify-start'}`}>
      {reactions.map((r, i) => (
        <li key={i} className='rounded-full border border-gray-200 bg-white px-1.5 text-sm leading-6 shadow-sm'>
          <span className='sr-only'>{senderLabel(r.byBusiness)}: </span>
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
export function WhatsappReactionNote({ emoji, byBusiness, alignEnd }: { emoji: string; byBusiness: boolean; alignEnd: boolean }) {
  return (
    <p className={`flex text-xs text-gray-500 ${alignEnd ? 'justify-end' : 'justify-start'}`}>
      <span>
        <span className='sr-only'>{senderLabel(byBusiness)}: </span>
        <span className='text-sm'>{emoji}</span> על הודעה קודמת
      </span>
    </p>
  )
}
