import { leadSourceChannel, leadSourceLabel } from '@/lib/leads/leadSourceLabel'
import { STATUS_STYLES } from '../LeadStatusCell'

/** Cell formatters for the leads / clients table (`config.funcs`). Presentation only. */

const SOURCE_STYLES: Record<string, string> = {
  facebook: 'bg-blue-100 text-blue-700',
  whatsapp: 'bg-green-100 text-green-700',
  instagram: 'bg-pink-100 text-pink-700',
  // Violet, not indigo/teal: at this tint indigo reads as Facebook's blue and
  // teal as WhatsApp's green. Carries no status meaning of its own.
  website: 'bg-violet-100 text-violet-700',
  manual: 'bg-gray-100 text-gray-600',
}

export function formatLeadSource(source) {
  // Normalize the stored (possibly composite `channel:externalId`) value to a
  // clean user-facing label + a canonical style key. The raw composite is never
  // rendered, and a WhatsApp/Facebook webhook lead now styles like its channel
  // instead of falling into the gray unknown bucket.
  const channel = leadSourceChannel(source)
  const cls = (channel && SOURCE_STYLES[channel]) || 'bg-gray-100 text-gray-600'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>
      {leadSourceLabel(source)}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status]
  if (!s) return null
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${s.bg} ${s.text} ${s.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

export function formatLeadStatus(_: unknown, obj: Record<string, unknown>) {
  return <StatusBadge status={obj.status as string} />
}

function getNextActionFromStatus(status: string | null): string | null {
  if (status === 'new') return 'התקשר עכשיו'
  if (status === 'contacted') return 'עקוב אחרי'
  if (status === 'interested') return 'סגור עסקה'
  return null
}

export function formatState(_: unknown, obj: Record<string, unknown>) {
  return <StatusBadge status={obj.status as string} />
}

export function formatNextAction(_: unknown, obj: Record<string, unknown>) {
  const nextAction = getNextActionFromStatus(obj.status as string | null)
  if (!nextAction) return null
  return <span className='text-xs font-medium text-gray-700'>{nextAction}</span>
}

export function formatLastContact(_: unknown, obj: Record<string, unknown>) {
  const raw = (obj.updatedAt as string | null) || (obj.createdAt as string | null)
  if (!raw) return null
  const days = Math.floor((Date.now() - new Date(raw).getTime()) / 86400000)
  const label = days <= 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`
  const isStale = days > 14
  return <span className={isStale ? 'text-xs font-medium text-amber-600' : 'text-xs font-medium text-gray-700'}>{label}</span>
}
