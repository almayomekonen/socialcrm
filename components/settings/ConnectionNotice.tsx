import type { ConnectionNotice as Notice } from '@/lib/connections/messages'
import { SHARED } from '@/lib/connections/messages'


const TONES = {
  attention: {
    box: 'border-amber-300 bg-amber-50',
    title: 'text-amber-800',
    body: 'text-amber-700',
    muted: 'text-amber-700/80',
  },
  error: {
    box: 'border-red-200 bg-red-50',
    title: 'text-red-800',
    body: 'text-red-700',
    muted: 'text-red-700/80',
  },
} as const

export default function ConnectionNotice({ notice }: { notice: Notice }) {
  const t = TONES[notice.tone]

  return (
    <div role='status' className={`rounded-md border p-3 ${t.box}`}>
      <p className={`text-sm font-medium ${t.title}`}>{notice.title}</p>
      <p className={`mt-1 text-sm ${t.body}`}>{notice.explanation}</p>

      {notice.reasons && notice.reasons.length > 0 && (
        <>
          <p className={`mt-2 text-xs ${t.muted}`}>{SHARED.reasonsLabel}</p>
          <ul className={`mt-0.5 list-disc ps-5 text-sm ${t.body}`}>
            {notice.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </>
      )}

      {notice.nextStep && <p className={`mt-2 text-sm ${t.body}`}>{notice.nextStep}</p>}
    </div>
  )
}
