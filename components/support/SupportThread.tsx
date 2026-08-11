import { timeAgo } from '@/components/settings/connections/copy'
import type { ThreadMessageView } from '@/lib/support/presenters'

/**
 * The conversation with SocialCRM support.
 *
 * Note the props type: there is no authorUserId here and there never will be.
 * The platform owner is always "צוות SocialCRM" to a customer, and the
 * projection in lib/support/presenters.ts is what guarantees it — this
 * component could not render an identity if it wanted to.
 *
 * Deliberately NOT a chat app. No bubbles with tails, no avatars, no read
 * receipts, no typing indicators. Support replies are distinguished by a tinted
 * card and a start border — enough to tell at a glance who is speaking, without
 * pretending this is a messaging product.
 */
export default function SupportThread({ messages }: { messages: ThreadMessageView[] }) {
  return (
    <ol className='space-y-3'>
      {messages.map((m) => {
        const fromSupport = m.authorKind !== 'customer'
        return (
          <li
            key={m.id}
            className={
              fromSupport
                ? 'rounded-2xl border border-primary/25 border-s-4 border-s-primary bg-primary-tint/40 p-4'
                : 'rounded-2xl border border-gray-200 bg-white p-4'
            }
          >
            <div className='mb-1.5 flex items-baseline justify-between gap-3'>
              <span
                className={`text-sm font-semibold ${fromSupport ? 'text-primary-text' : 'text-ink'}`}
              >
                {m.authorLabel}
              </span>
              <span className='shrink-0 text-xs text-gray-400'>
                {timeAgo(new Date(m.createdAt).toISOString())}
              </span>
            </div>
            <p className='whitespace-pre-line text-sm leading-relaxed text-gray-700'>{m.body}</p>
          </li>
        )
      })}
    </ol>
  )
}
