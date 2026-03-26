'use client'

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  new: { label: 'חדש', cls: 'bg-blue-100 text-blue-700' },
  contacted: { label: 'דיברתי', cls: 'bg-yellow-100 text-yellow-700' },
  interested: { label: 'מתעניין', cls: 'bg-green-100 text-green-700' },
  closed: { label: 'סגור', cls: 'bg-gray-100 text-gray-600' },
  lost: { label: 'אבוד', cls: 'bg-red-100 text-red-600' },
}

const SOURCE_STYLES: Record<string, string> = {
  facebook: 'bg-blue-100 text-blue-700',
  whatsapp: 'bg-green-100 text-green-700',
  instagram: 'bg-pink-100 text-pink-700',
  manual: 'bg-gray-100 text-gray-600',
}

export function formatStatus(status) {
  const mapped = STATUS_MAP[status]
  if (mapped) return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${mapped.cls}`}>{mapped.label}</span>
  return <span className='text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600'>{status ? 'פעיל' : 'לא פעיל'}</span>
}

export function formatLeadSource(source) {
  const s = (source || 'manual').toLowerCase()
  const cls = SOURCE_STYLES[s] || 'bg-gray-100 text-gray-600'
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>{source || 'manual'}</span>
}

export function getPipelineHeaders() {
  return [
    { key: 'rank', label: 'סטטוס', format: 'formatRank' },
    { key: 'name', label: 'שם מלא', format: 'formatName' },
    { key: '_priority', label: 'עדיפות', format: 'formatPriority' },
    { key: 'lastActivityAt', label: 'פעילות אחרונה', format: 'formatUpdatedAt' },
  ]
}

export function getHeaders(leads) {
  const headers = [
    { key: 'rank', label: 'סטטוס', format: 'formatRank' },
    { key: 'name', label: 'שם מלא', format: 'formatName' },
    { key: 'idNum', label: 'ת"ז', noShow: true },
    { key: 'status', label: 'סטטוס', format: 'formatStatus', noShow: true },
    { key: 'userName', label: 'נציג' },
    { key: 'handlerName', label: 'אחראי', noShow: true },
    { key: 'phone', label: 'מספר טלפון' },
    { key: 'email', label: 'מייל' },
    { key: 'leadSource', label: 'מקור', format: 'formatLeadSource' },
    // { key: 'updatedAt', label: 'תאריך פעילות אחרון', format: 'formatDate' },
  ]
  if (leads) {
    headers.push(
      { key: 'masleka', label: 'ערוץ א', noShow: true },
      { key: 'harHabituach', label: 'ערוץ ב', noShow: true },
      { key: 'polisot', label: 'מוצרים פעילים', noShow: true },
    )
  }
  return headers
}
