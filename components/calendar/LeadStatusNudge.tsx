import { Btn } from '@/lib/btns/Btn'
import { STATUS_STYLES } from '@/components/clients/LeadStatusCell'
import type { SuggestedLeadStatus } from '@/lib/calendar/outcomeStatusSuggestion'

// Inline banner shown inside MeetingDetailsDialog after a successful outcome
// mark, when the server returned a suggestedLeadStatus. One-click "עדכן ל-"
// applies via the existing updateLead path; "סגור" dismisses without
// touching the lead. Reuses STATUS_STYLES so the pill visual matches the
// leads-table palette the rep already knows.

type Props = {
  suggested: SuggestedLeadStatus
  onApply: () => void
  onDismiss: () => void
  busy: boolean
}

export default function LeadStatusNudge({ suggested, onApply, onDismiss, busy }: Props) {
  const s = STATUS_STYLES[suggested]
  return (
    <div className='rounded-md border border-blue-200 bg-blue-50/60 p-3 grid gap-2 text-sm'>
      {/* Lead with the rep's just-completed action ("סימנת…") so the banner
          anchors to the feedback they expect (ux-guidelines §8) before
          asking for the next move. Pill reuses STATUS_STYLES so the visual
          matches the leads-table palette one-to-one. */}
      <div className='text-gray-800'>
        סימנת את הפגישה כהושלמה. מומלץ לעדכן את סטטוס הליד ל-
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 mx-1 text-xs font-medium ${s.bg} ${s.text} ${s.border}`}
        >
          <span className={`size-1.5 rounded-full ${s.dot}`} />
          {s.label}
        </span>
      </div>
      <div className='flex gap-2 justify-end'>
        <Btn lbl='לא עכשיו' variant='outline' onClick={onDismiss} disabled={busy} />
        {/* No quotes around the label — straight ASCII quotes render as
            neutral characters in Hebrew RTL and can flip visually. */}
        <Btn
          lbl={busy ? 'מעדכן…' : `עדכן סטטוס ל${s.label}`}
          variant='solid'
          onClick={onApply}
          disabled={busy}
        />
      </div>
    </div>
  )
}
