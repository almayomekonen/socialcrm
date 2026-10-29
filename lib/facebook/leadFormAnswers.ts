/**
 * Lead Ads form answers — the pure half: normalise what Meta sends, label it
 * for the owner. No I/O; db/leadFormAnswers.ts stores it.
 *
 * Meta's `field_data` is `[{ name, values: string[] }]`, one entry per form
 * question. Standard questions use fixed keys (`full_name`, `phone_number`,
 * `city`); a custom question's key is derived from the question the owner
 * wrote. Values are what the customer entered or picked — several for a
 * multiple-choice question, none if Meta sent the field empty.
 */

import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

export type LeadFormAnswer = {
  /** Meta's field name, as sent (trimmed, bounded). */
  key: string
  /** The answers, in order. Empty when the field arrived with no value. */
  values: string[]
}

/** Bounds: form input from another system, stored as-is and shown to people. */
const MAX_FIELDS = 50
const MAX_KEY_LENGTH = 200
const MAX_VALUES = 20
const MAX_VALUE_LENGTH = 1000

// Control characters and bidi overrides/isolates — never meaningful in an answer.
const UNSAFE_TEXT = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g

function clean(text: string, max: number): string {
  return text.replace(UNSAFE_TEXT, '').trim().slice(0, max)
}

/**
 * Every field, in form order. Repeated keys are kept as separate entries (a
 * form can ask the same standard question twice); a malformed entry is skipped
 * rather than failing the lead. Numbers and booleans are kept as text.
 */
export function normalizeFormAnswers(fieldData: unknown): LeadFormAnswer[] {
  if (!Array.isArray(fieldData)) return []
  const out: LeadFormAnswer[] = []
  for (const raw of fieldData) {
    if (out.length >= MAX_FIELDS) break
    if (!raw || typeof raw !== 'object') continue
    const f = raw as { name?: unknown; values?: unknown }
    if (typeof f.name !== 'string') continue
    const key = clean(f.name, MAX_KEY_LENGTH)
    if (!key) continue
    const values = (Array.isArray(f.values) ? f.values : [])
      .filter((v): v is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof v))
      .map((v) => clean(String(v), MAX_VALUE_LENGTH))
      .filter(Boolean)
      .slice(0, MAX_VALUES)
    out.push({ key, values })
  }
  return out
}

/** Fields the lead itself already holds and shows (name, phone, email). */
const CONTACT_KEYS = new Set(['full_name', 'name', 'first_name', 'last_name', 'phone_number', 'phone', 'email'])

/**
 * Meta's STANDARD question keys, labelled by our catalog (`leadDetail.formField.*`;
 * Hebrew is the product wording these labels always had). A custom question is
 * the owner's own text and is never translated.
 */
const STANDARD_LABELS: Record<string, MessageKey> = {
  city: 'leadDetail.formField.city',
  state: 'leadDetail.formField.state',
  country: 'leadDetail.formField.country',
  province: 'leadDetail.formField.province',
  street_address: 'leadDetail.formField.street_address',
  post_code: 'leadDetail.formField.post_code',
  zip_code: 'leadDetail.formField.zip_code',
  company_name: 'leadDetail.formField.company_name',
  job_title: 'leadDetail.formField.job_title',
  work_email: 'leadDetail.formField.work_email',
  work_phone_number: 'leadDetail.formField.work_phone_number',
  date_of_birth: 'leadDetail.formField.date_of_birth',
  gender: 'leadDetail.formField.gender',
  marital_status: 'leadDetail.formField.marital_status',
  relationship_status: 'leadDetail.formField.relationship_status',
}

/**
 * The answers worth showing next to the lead: everything except the contact
 * details the lead already displays. Stored answers are never filtered — only
 * what is shown.
 */
export function displayableFormAnswers(answers: readonly LeadFormAnswer[]): LeadFormAnswer[] {
  return answers.filter((a) => !CONTACT_KEYS.has(a.key.toLowerCase()))
}

/**
 * The owner-facing label: ours for a standard question (in the interface
 * language, Hebrew by default), otherwise the custom question as written ("מה_התקציב_שלך?" → "מה התקציב שלך?").
 */
export function formAnswerLabel(key: string, locale: UiLocale = 'he'): string {
  const standard = STANDARD_LABELS[key.toLowerCase()]
  return standard ? translatorFor(locale)(standard) : key.replace(/_+/g, ' ').trim()
}
