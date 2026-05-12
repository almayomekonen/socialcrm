
export function UserMessagePill({ text }: { text: string }) {
  return (
    <div
      dir='rtl'
      className='w-fit max-w-full me-auto rounded-2xl bg-gray-100 px-3 py-2 text-[13px] leading-relaxed text-gray-900 text-right whitespace-pre-wrap wrap-break-word'
    >
      {text}
    </div>
  )
}
