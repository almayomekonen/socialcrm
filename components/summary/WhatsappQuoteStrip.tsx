import { QUOTE_NOT_FOUND, type ThreadQuote } from '@/lib/inbox/whatsappThreadView'

/**
 * The message a reply quotes, above the reply's text, as WhatsApp shows it: one
 * line of the quoted message, or "a reply to an earlier message" when that
 * message is not in this thread. Shared by the desktop and mobile threads.
 */
export default function WhatsappQuoteStrip({ quote }: { quote: ThreadQuote }) {
  return (
    <p className='mb-1 truncate rounded-md border-s-2 border-gray-400 bg-black/5 px-2 py-1 text-xs leading-snug text-gray-600'>
      <span className='sr-only'>ציטוט: </span>
      {quote.preview ?? QUOTE_NOT_FOUND}
    </p>
  )
}
