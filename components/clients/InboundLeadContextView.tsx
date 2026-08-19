import Link from 'next/link'
import Icon from '@/lib/Icon'
import { INBOUND_LEAD_COPY } from '@/lib/leads/inboundLeadCopy'
import { facebookCapturedFieldLabels } from '@/lib/leads/inboundLeadContextData'

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
  /**
   * Facebook only: which CATEGORIES of contact detail the lead currently holds.
   * These drive the "נקלטו אוטומטית" evidence labels. They reflect current field
   * PRESENCE, not untouched provenance — there is no per-field history, so a value
   * edited by the user later still counts. We never render the values themselves.
   */
  hasName?: boolean
  hasPhone?: boolean
  hasEmail?: boolean
  /**
   * Facebook only: SocialCRM's CAPTURE time (clients.createdAt), pre-formatted
   * server-side in the business timezone. NOT Meta's submission time — copy says
   * "נקלט אצלך", never "נשלח"/"מילא".
   */
  capturedAt?: string | null
}

export function InboundLeadContextView({
  channel,
  conversationId,
  preview,
  hasName,
  hasPhone,
  hasEmail,
  capturedAt,
}: Props) {
  if (channel === 'facebook') {
    // Evidence labels for the categories actually present — never the values.
    const capturedLabels = facebookCapturedFieldLabels(hasName, hasPhone, hasEmail)
    return (
      <section dir='rtl' className='mb-6 rounded-lg border border-gray-200 bg-white p-4'>
        <div className='flex items-start gap-3'>
          <span className='flex size-8 flex-none items-center justify-center rounded-lg bg-[#1877F2]/10'>
            <Icon name='facebook' type='reg' aria-hidden className='size-4 bg-[#1877F2]' />
          </span>
          <div className='min-w-0 flex-1'>
            <h2 className='text-sm font-semibold text-ink'>{INBOUND_LEAD_COPY.facebookHeadline}</h2>
            <p className='mt-0.5 text-sm text-gray-600'>{INBOUND_LEAD_COPY.facebookBody}</p>

            {capturedLabels.length > 0 || capturedAt ? (
              <div className='mt-2 flex flex-col gap-0.5 text-xs text-gray-500'>
                {capturedLabels.length > 0 ? (
                  <p>
                    {INBOUND_LEAD_COPY.capturedFieldsPrefix}: {capturedLabels.join(' · ')}
                  </p>
                ) : null}
                {capturedAt ? (
                  <p>
                    {INBOUND_LEAD_COPY.capturedAtPrefix}
                    {capturedAt}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    )
  }

  // WhatsApp. Supporting copy reflects whether a conversation was captured too.
  const supporting = conversationId
    ? INBOUND_LEAD_COPY.whatsappWithConversation
    : INBOUND_LEAD_COPY.whatsappWithoutConversation

  return (
    <section dir='rtl' className='mb-6 rounded-lg border border-gray-200 bg-white p-4'>
      <div className='flex items-start gap-3'>
        <span className='flex size-8 flex-none items-center justify-center rounded-lg bg-[#25D366]/10'>
          <Icon name='whatsapp' type='reg' aria-hidden className='size-4 bg-[#25D366]' />
        </span>
        <div className='min-w-0 flex-1'>
          <h2 className='text-sm font-semibold text-ink'>{INBOUND_LEAD_COPY.whatsappHeadline}</h2>
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
              {INBOUND_LEAD_COPY.openConversation}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  )
}
