
export function UserMessagePill({ text }: { text: string }) {
  return (
    <div
      dir='rtl'
      className='w-fit max-w-full me-auto rounded-lg bg-gray-100 px-3 py-2 text-sm leading-relaxed text-gray-900 text-right whitespace-pre-wrap wrap-break-word'
    >
      {text}
    </div>
  )
}
