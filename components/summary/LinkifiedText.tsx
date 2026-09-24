import { linkifyText } from '@/lib/inbox/linkifyText'

// Renders message text with http(s)/www URLs as links that open in a new tab.
export default function LinkifiedText({ children }: { children: string }) {
  return linkifyText(children).map((s, i) =>
    s.kind === 'link' ? (
      <a
        key={i}
        href={s.href}
        target='_blank'
        rel='noopener noreferrer'
        dir='ltr'
        className='text-primary-text underline underline-offset-2 break-all'
      >
        {s.value}
      </a>
    ) : (
      s.value
    ),
  )
}
