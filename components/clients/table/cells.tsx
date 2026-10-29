'use client'

import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'
import { leadSourceChannel, leadSourceLabel } from '@/lib/leads/leadSourceLabel'
import { leadStatusLabel } from '@/lib/leads/statusStyles'
import { STATUS_STYLES } from '../LeadStatusCell'

/**
 * Cell formatters for the leads / clients table (`config.funcs`). Presentation
 * only. Each returns a small component so its label follows the interface
 * language (`useT`); the wrappers add no DOM of their own.
 */

const SOURCE_STYLES: Record<string, string> = {
  facebook: 'bg-blue-100 text-blue-700',
  whatsapp: 'bg-green-100 text-green-700',
  instagram: 'bg-pink-100 text-pink-700',
  // Violet, not indigo/teal: at this tint indigo reads as Facebook's blue and
  // teal as WhatsApp's green. Carries no status meaning of its own.
  website: 'bg-violet-100 text-violet-700',
  manual: 'bg-gray-100 text-gray-600',
}

function SourceChip({ source }: { source: string | null | undefined }) {
  const { locale } = useT()
  // Normalize the stored (possibly composite `channel:externalId`) value to a
  // clean user-facing label + a canonical style key. The raw composite is never
  // rendered, and a WhatsApp/Facebook webhook lead now styles like its channel
  // instead of falling into the gray unknown bucket.
  const channel = leadSourceChannel(source)
  const cls = (channel && SOURCE_STYLES[channel]) || 'bg-gray-100 text-gray-600'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>
      {leadSourceLabel(source, locale)}
    </span>
  )
}

export function formatLeadSource(source) {
  return <SourceChip source={source} />
}

function StatusBadge({ status }: { status: string }) {
  const { locale } = useT()
  const s = STATUS_STYLES[status]
  if (!s) return null
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${s.bg} ${s.text} ${s.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {leadStatusLabel(status, locale)}
    </span>
  )
}

export function formatLeadStatus(_: unknown, obj: Record<string, unknown>) {
  return <StatusBadge status={obj.status as string} />
}

/** The suggested next step, by status CODE. */
const NEXT_ACTION_KEY: Record<string, MessageKey> = {
  new: 'leads.table.nextAction.new',
  contacted: 'leads.table.nextAction.contacted',
  interested: 'leads.table.nextAction.interested',
}

export function formatState(_: unknown, obj: Record<string, unknown>) {
  return <StatusBadge status={obj.status as string} />
}

function NextAction({ status }: { status: string | null }) {
  const t = useT()
  const key = status ? NEXT_ACTION_KEY[status] : undefined
  if (!key) return null
  return <span className='text-xs font-medium text-gray-700'>{t(key)}</span>
}

export function formatNextAction(_: unknown, obj: Record<string, unknown>) {
  return <NextAction status={obj.status as string | null} />
}

function LastContact({ raw }: { raw: string }) {
  const t = useT()
  const days = Math.floor((Date.now() - new Date(raw).getTime()) / 86400000)
  const label =
    days <= 0
      ? t('leads.table.lastContact.today')
      : days === 1
        ? t('leads.table.lastContact.yesterday')
        : t('leads.table.lastContact.daysAgo', { count: String(days) })
  const isStale = days > 14
  return <span className={isStale ? 'text-xs font-medium text-amber-600' : 'text-xs font-medium text-gray-700'}>{label}</span>
}

export function formatLastContact(_: unknown, obj: Record<string, unknown>) {
  const raw = (obj.updatedAt as string | null) || (obj.createdAt as string | null)
  if (!raw) return null
  return <LastContact raw={raw} />
}

/** The "customer" badge beside a closed lead's name. */
export function CustomerBadge() {
  const t = useT()
  return (
    <span className='text-xs px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium whitespace-nowrap'>
      {t('leads.table.customer')}
    </span>
  )
}
