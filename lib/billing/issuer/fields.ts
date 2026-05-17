import { sanitizeTaxId, validateTaxId } from './taxId'

export type FieldTier = 1 | 2

export type FieldInputType = 'text' | 'tel' | 'email' | 'textarea' | 'radio' | 'file'

export type BusinessType = 'exempt' | 'authorized' | 'company'

export const BUSINESS_TYPE_OPTIONS: ReadonlyArray<{
  value: BusinessType
  label: string
  description: string
}> = [
  {
    value: 'exempt',
    label: 'עוסק פטור',
    description: 'הכנסה שנתית עד 120,000 ₪. לא גובה מע"מ.',
  },
  {
    value: 'authorized',
    label: 'עוסק מורשה',
    description: 'רוב העצמאים בישראל. גובה מע"מ.',
  },
  {
    value: 'company',
    label: 'חברה בע"מ',
    description: 'חברה רשומה ברשם החברות (ח.פ).',
  },
] as const

const BUSINESS_TYPE_VALUES: ReadonlyArray<BusinessType> = BUSINESS_TYPE_OPTIONS.map((o) => o.value)

export type FieldDescriptor = {
  key: string
  label: string
  helpText?: string
  placeholder?: string
  tier: FieldTier
  inputType: FieldInputType
  options?: ReadonlyArray<{ value: string; label: string; description: string }>
  sanitize?: (value: unknown) => unknown
  validate: (value: unknown, allValues: Record<string, unknown>) => true | string
}

export const ISSUER_FIELDS: ReadonlyArray<FieldDescriptor> = [
  {
    key: 'name',
    label: 'שם העסק',
    helpText: 'כפי שיופיע בחשבוניות',
    placeholder: 'לדוגמה: רחל כהן ייעוץ',
    tier: 1,
    inputType: 'text',
    validate: (v) => {
      if (typeof v !== 'string' || !v.trim()) return 'שם העסק חובה'
      return true
    },
  },
  {
    key: 'businessType',
    label: 'סוג העסק',
    helpText: 'לא בטוחים? תוכלו לעדכן בהמשך בהגדרות.',
    tier: 1,
    inputType: 'radio',
    options: BUSINESS_TYPE_OPTIONS,
    validate: (v) => {
      if (typeof v !== 'string' || !BUSINESS_TYPE_VALUES.includes(v as BusinessType)) {
        return 'יש לבחור סוג עסק'
      }
      return true
    },
  },
  {
    key: 'taxId',
    label: 'מספר עוסק / ח.פ',
    helpText: '8 ספרות לעצמאי, 9 ספרות לחברה. ללא מקפים.',
    placeholder: '123456789',
    tier: 1,
    inputType: 'text',
    sanitize: sanitizeTaxId,
    validate: (v, all) => {
      if (typeof v !== 'string' || !v.trim()) return 'מספר עוסק / ח.פ חובה'
      return validateTaxId(v, all.businessType as BusinessType | null | undefined)
    },
  },
  {
    key: 'address',
    label: 'כתובת',
    helpText: 'תופיע על החשבוניות. נדרשת לעוסק מורשה ולחברה.',
    placeholder: 'לדוגמה:\nרוטשילד 12\nתל אביב 6688112',
    tier: 2,
    inputType: 'textarea',
    validate: () => true,
  },
  {
    key: 'phone',
    label: 'טלפון',
    placeholder: '054-1234567',
    tier: 2,
    inputType: 'tel',
    validate: () => true,
  },
  {
    key: 'email',
    label: 'אימייל לחשבוניות',
    helpText: 'משמש ככתובת המשיב כשהלקוח עונה למייל.',
    placeholder: 'billing@yourbusiness.com',
    tier: 2,
    inputType: 'email',
    validate: (v) => {
      if (typeof v !== 'string' || v.trim() === '') return true
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return emailPattern.test(v.trim()) ? true : 'כתובת אימייל לא תקינה'
    },
  },
  {
    key: 'img',
    label: 'לוגו',
    helpText: 'תמונת PNG או JPG. תופיע בראש החשבונית.',
    tier: 2,
    inputType: 'file',
    validate: () => true,
  },
]

export const ISSUER_TIER_3_DEFAULTS = {
  country: 'IL',
  defaultCurrency: 'ILS',
  locale: 'he',
  docNumberFormat: 'YYYY-NNNN',
  bankDetails: {} as Record<string, unknown>,
} as const

export type IssuerData = {
  name: string | null
  businessType: BusinessType | null
  taxId: string | null
  address: string | null
  phone: string | null
  email: string | null
  img: number | null
  country: string
  defaultCurrency: string
  locale: string
  docNumberFormat: string
  bankDetails: Record<string, unknown>
}

export function getFieldByKey(key: string): FieldDescriptor | undefined {
  return ISSUER_FIELDS.find((f) => f.key === key)
}

export function fieldsByTier(tiers: ReadonlyArray<FieldTier>): ReadonlyArray<FieldDescriptor> {
  return ISSUER_FIELDS.filter((f) => tiers.includes(f.tier))
}

export const TIER_1_KEYS: ReadonlyArray<string> = ISSUER_FIELDS.filter((f) => f.tier === 1).map((f) => f.key)
