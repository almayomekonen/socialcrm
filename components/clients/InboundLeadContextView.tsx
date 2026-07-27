import Link from 'next/link'
import Icon from '@/lib/Icon'

/**
 * Presentational, side-effect-free view for the "this lead arrived automatically"
 * context surface. All data (channel, first-inbound preview, conversation id) is
 * resolved by the server wrapper and passed in — this component only renders.
 *
 * Static page metadata, NOT an announced event: plain semantic structure, no
 * role='status', not dismissible, no one-shot state.
 */
type Props = {
  channel: 'whatsapp' | 'facebook'
  /** WhatsApp only: the linked conversation id, when one exists. */
  conversationId?: number | null
  /** WhatsApp only: the customer's FIRST inbound message text, when usable. */
  preview?: string | null
}

export function InboundLeadContextView({ channel, conversationId, preview }: Props) {
  if (channel === 'facebook') {
    return (
      <section dir='rtl' className='mb-6 rounded-lg border border-gray-200 bg-white p-4'>
        <div className='flex items-start gap-3'>
          <span className='flex size-8 flex-none items-center justify-center rounded-lg bg-[#1877F2]/10'>
            <Icon name='facebook' type='reg' aria-hidden className='size-4 bg-[#1877F2]' />
          </span>
          <div className='min-w-0 flex-1'>
            <h2 className='text-sm font-semibold text-ink'>הליד הזה הגיע אליך אוטומטית מ־Facebook</h2>
            <p className='mt-0.5 text-sm text-gray-600'>SocialCRM קלט את פרטי הליד אוטומטית מהמודעה שלך.</p>
          </div>
        </div>
      </section>
    )
  }

  // WhatsApp. Supporting copy reflects whether a conversation was captured too.
  const supporting = conversationId
    ? 'SocialCRM קלט את הליד והשיחה ברגע שהלקוח פנה אליך.'
    : 'SocialCRM קלט את הליד ברגע שהלקוח פנה אליך.'

  return (
    <section dir='rtl' className='mb-6 rounded-lg border border-gray-200 bg-white p-4'>
      <div className='flex items-start gap-3'>
        <span className='flex size-8 flex-none items-center justify-center rounded-lg bg-[#25D366]/10'>
          <Icon name='whatsapp' type='reg' aria-hidden className='size-4 bg-[#25D366]' />
        </span>
        <div className='min-w-0 flex-1'>
          <h2 className='text-sm font-semibold text-ink'>הליד הזה הגיע אליך אוטומטית מ־WhatsApp</h2>
          <p className='mt-0.5 text-sm text-gray-600'>{supporting}</p>

          {preview ? (
            // Real persisted customer text, rendered as text (React escapes it),
            // dir='auto' for natural RTL/LTR, clamped so a long message can't grow
            // the surface. Secondary to the lead.
            <p
              dir='auto'
              className='mt-2 line-clamp-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-700'
            >
              {preview}
            </p>
          ) : null}

          {conversationId ? (
            <Link
              href={`/inbox?conversation=${conversationId}`}
              className='mt-3 inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50'
            >
              <Icon name='whatsapp' type='reg' aria-hidden className='size-3.5 bg-[#25D366]' />
              פתח את השיחה
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  )
}
