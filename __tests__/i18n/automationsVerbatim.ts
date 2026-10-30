import type { Allowance } from './leakScan'
import { listTemplates } from '@/lib/automations/templates/registry'
import { prepare } from '@/lib/automations/templates/install'

/**
 * What the automations screens show EXACTLY as written in every language
 * (leak-gate reason `verbatim-content`, Phase E5b):
 *
 *  - the automations each template would create — their names and their
 *    subject / task title, as installing stores them (the install dialog's
 *    "what will be created" list, a declared Hebrew region);
 *  - the variable TOKEN the business types (`{{שם הליד}}`) where a help line or
 *    the quote composer's heading quotes it;
 *  - the website set-up snippet's placeholder line, which is part of the code
 *    the customer copies.
 *
 * Derived from the registry itself, so a new template is covered without an edit.
 */
const created = listTemplates().flatMap((t) => prepare(t).flatMap((p) => [p.name, p.parameters.subject || p.parameters.title || ''])).filter(Boolean)

export const VERBATIM: Allowance[] = [...new Set([...created, '{{שם הליד}}', "$secret = 'הקוד-הסודי-ששמרתם'; // הקוד מוצג פעם אחת בלבד ביצירת החיבור"])].map((text) => ({
  text,
  reason: 'verbatim-content' as const,
}))
