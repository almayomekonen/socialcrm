import type { Template, TemplateStatus } from '@/lib/whatsapp/templates/types'
import TemplateRow from './TemplateRow'

/**
 * The list of ready-made messages. Rejected float to the top (they need the
 * owner), then pending, then approved — UX spec §5. Pure presentation.
 */
const SORT_ORDER: Record<TemplateStatus, number> = {
  rejected: 0,
  pending: 1,
  approved: 2,
  paused: 3,
  disabled: 4,
}

export default function TemplateList({ templates }: { templates: Template[] }) {
  const sorted = [...templates].sort((a, b) => (SORT_ORDER[a.status] ?? 9) - (SORT_ORDER[b.status] ?? 9))
  return (
    <ul className='grid list-none gap-2' aria-label='הודעות מוכנות'>
      {sorted.map((t) => (
        <li key={t.id}>
          <TemplateRow template={t} />
        </li>
      ))}
    </ul>
  )
}
