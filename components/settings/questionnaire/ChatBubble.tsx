/**
 * One WhatsApp message, in the same in/out geometry the agent test chat uses
 * (AgentPreview): the business's message is green and sits at the end, the
 * customer's is white and sits at the start. The text is shown exactly as
 * given, line breaks included; formatting happens upstream, in production code.
 */
export default function ChatBubble({
  from,
  text,
  label,
}: {
  from: 'business' | 'customer'
  text: string
  /** Screen-reader context, e.g. "הודעה מהעסק". */
  label?: string
}) {
  const business = from === 'business'
  return (
    <div className={business ? 'self-end max-w-[88%]' : 'self-start max-w-[88%]'}>
      {label && <span className='sr-only'>{label}: </span>}
      <p
        dir='rtl'
        className={
          business
            ? 'whitespace-pre-line break-words rounded-lg rounded-br-sm border border-[#25D366]/35 bg-[#25D366]/12 px-3.5 py-2 text-sm leading-relaxed'
            : 'whitespace-pre-line break-words rounded-lg rounded-bl-sm border border-gray-200 bg-white px-3.5 py-2 text-sm leading-relaxed'
        }
      >
        {text}
      </p>
    </div>
  )
}
