import { genderOpt, leadSourceCreateOpt } from '@/types/lists'
import type { MessageKey, Translator } from '@/lib/i18n/translate'
import { leadStatusFormLabel } from '@/lib/leads/statusStyles'

/** The phone add-lead form's option lists (extracted from `LeadFormMobile`, Phase F2). */
const STATUS_OPTIONS = [
  { name: 'חדש', id: 'new' },
  { name: 'בטיפול', id: 'contacted' },
  { name: 'מתעניין', id: 'interested' },
  { name: 'נסגר', id: 'closed' },
  { name: 'לא רלוונטי', id: 'lost' },
]

/**
 * Display labels for the stored option VALUES (same mapping as the desktop
 * `clientForm`). The form submits the stored value unchanged; Hebrew passes the
 * exact option lists it always passed.
 */
const GENDER_KEY: Record<string, MessageKey> = { 'זכר': 'leads.form.genderOption.male', 'נקבה': 'leads.form.genderOption.female' }
const SOURCE_KEY: Record<string, MessageKey> = {
  'ידני': 'leads.form.sourceOption.manual',
  'אתר': 'leads.form.sourceOption.website',
  'המלצה': 'leads.form.sourceOption.referral',
  'ייבוא': 'leads.form.sourceOption.import',
  'אחר': 'leads.form.sourceOption.misc',
}
export function formOptions(t: Translator) {
  if (t.locale === 'he') return { gender: genderOpt, source: leadSourceCreateOpt, status: STATUS_OPTIONS }
  const label = (values: string[], keys: Record<string, MessageKey>) => values.map((v) => ({ id: v, name: keys[v] ? t(keys[v]) : v }))
  return {
    gender: label(genderOpt, GENDER_KEY),
    source: label(leadSourceCreateOpt, SOURCE_KEY),
    status: STATUS_OPTIONS.map((o) => ({ id: o.id, name: leadStatusFormLabel(o.id, t.locale) as string })),
  }
}

