import { describe, expect, it } from 'vitest'
import { computeQuoteTotals } from '@/lib/quotes/totals'
import { validateQuoteTemplateDraft, type QuoteTemplateDraft } from '@/lib/quotes/templateValidation'
import { creatorFor, FIRST_PARTY_CREATORS } from '@/components/settings/templates/firstPartyCreators'
import { FIRST_PARTY_SOURCES } from '@/lib/automations/catalog/vocabularies'
import { getTemplate } from '@/lib/automations/templates/registry'
import { prepare } from '@/lib/automations/templates/install'
import { declaredParameterAnswers } from '@/lib/automations/definitionInput'
import { actionsForContent } from '@/lib/automations/actionEntry'
import { ERRORS } from '@/components/settings/templates/copy'

/**
 * INSTALLING THE QUOTATION AUTOMATION WITHOUT LEAVING THE INSTALLER.
 *
 * The flow is: build the price list in the shared dialog → save it through the
 * ordinary quote-template domain → hand its id back as the template variable's
 * value → install exactly as any other template installs.
 *
 * These pin the contract of that sequence: the shell stays generic, the domain
 * stays the single authority for money and validation, and the id genuinely
 * reaches the executor's parameters.
 */

const draft = (over: Partial<QuoteTemplateDraft> = {}): QuoteTemplateDraft => ({
  name: 'בניית אתר',
  title: 'בניית אתר',
  introText: '',
  termsText: '',
  validityDays: 14,
  items: [
    { title: 'בניית אתר', description: '', quantity: 1, unitPrice: 4000, discount: 0, isOptional: false },
    { title: 'עיצוב', description: '', quantity: 1, unitPrice: 900, discount: 0, isOptional: false },
    { title: 'SEO', description: '', quantity: 1, unitPrice: 500, discount: 0, isOptional: false },
  ],
  ...over,
})

describe('the creator is selected by first-party SOURCE, never by template or action', () => {
  it('registers a creator for quote_templates', () => {
    expect(creatorFor('quote_templates')).toBeTruthy()
  })

  it('every registered creator names a declared first-party source', () => {
    for (const key of Object.keys(FIRST_PARTY_CREATORS)) {
      expect(FIRST_PARTY_SOURCES, `"${key}" is not a declared source`).toContain(key)
    }
  })

  it('a source with no creator keeps the plain picker — nothing regresses by omission', () => {
    expect(creatorFor('pipeline_stages')).toBeNull()
    expect(creatorFor(undefined)).toBeNull()
    expect(creatorFor('')).toBeNull()
  })
})

describe('the composer uses the domain, not a second engine', () => {
  it('totals match the brief exactly — 4,000 + 900 + 500 = 5,400 before VAT', () => {
    const totals = computeQuoteTotals(draft().items.map((i) => ({ ...i, taxRatePercentSnapshot: 0 })))
    expect(totals.subtotalAmount).toBe(5400)
    expect(totals.totalAmount).toBe(5400)
    expect(totals.lines.map((l) => l.lineSubtotal)).toEqual([4000, 900, 500])
  })

  it('VAT comes from AGENCY policy, applied over the same lines', () => {
    const at = (rate: number) => computeQuoteTotals(draft().items.map((i) => ({ ...i, taxRatePercentSnapshot: rate })))
    expect(at(18).taxAmount).toBe(972)
    expect(at(18).totalAmount).toBe(6372)
    // An exempt business previews 0% and pays 0% — the template stores no rate.
    expect(at(0).taxAmount).toBe(0)
    expect(at(0).totalAmount).toBe(5400)
  })

  it('an optional line shows its price but is excluded from the total', () => {
    const items = [...draft().items, { title: 'תחזוקה', description: '', quantity: 12, unitPrice: 200, discount: 0, isOptional: true }]
    const totals = computeQuoteTotals(items.map((i) => ({ ...i, taxRatePercentSnapshot: 0 })))
    expect(totals.subtotalAmount).toBe(5400)
    expect(totals.lines[3].lineSubtotal).toBe(2400)
  })

  it('editing a line changes the total through the same function', () => {
    const edited = draft({ items: [{ ...draft().items[0], quantity: 2 }] })
    expect(computeQuoteTotals(edited.items.map((i) => ({ ...i, taxRatePercentSnapshot: 0 }))).subtotalAmount).toBe(8000)
  })

  it('validation is the domain’s — an empty line or a bad validity is refused before saving', () => {
    expect(validateQuoteTemplateDraft(draft())).toBeNull()
    expect(validateQuoteTemplateDraft(draft({ name: '' }))).toBe('name_required')
    expect(validateQuoteTemplateDraft(draft({ items: [] }))).toBe('items_required')
    expect(validateQuoteTemplateDraft(draft({ validityDays: 0 }))).toBe('validity_invalid')
    expect(validateQuoteTemplateDraft(draft({ items: [{ ...draft().items[0], title: '' }] }))).toBe('item_title_required')
  })

  it('every reason the resolver can return has Hebrew in the dialog’s copy', () => {
    // A raw machine code must never reach a customer, whichever step produced it.
    for (const reason of [
      'template_required', 'name_required', 'name_too_long', 'name_taken', 'title_too_long',
      'validity_invalid', 'items_required', 'too_many_items', 'item_title_required',
      'item_title_too_long', 'item_quantity_invalid', 'item_price_invalid', 'item_discount_invalid',
      'invalid_input',
    ]) {
      expect(ERRORS[reason], `no copy for "${reason}"`).toBeTruthy()
    }
  })
})

describe('the resolved id reaches the installed automation', () => {
  it('the saved template id becomes the action’s quoteTemplateId', () => {
    const template = getTemplate('quote_on_lead_stage')!
    // What the dialog passes to installTemplate once the resolver has run.
    const [p] = prepare(template, { quoteTemplateId: '77' })
    expect(p.actionKey).toBe('quote.create')
    expect(p.parameters.quoteTemplateId).toBe('77')

    const content = { subject: '', body: '', timing: p.timing, actionParameters: declaredParameterAnswers(p.actionKey, p.parameters) }
    expect(content.actionParameters).toEqual({ quoteTemplateId: '77' })
    // …and out the projection the executor reads at run time.
    expect(actionsForContent(p.actionKey, content as never)[0].parameters.quoteTemplateId).toBe('77')
  })

  it('the template still declares the variable the composer answers', () => {
    const variable = getTemplate('quote_on_lead_stage')!.variables[0]
    expect(variable.key).toBe('quoteTemplateId')
    expect(variable.type).toBe('enum_agency')
    expect(variable.optionSource).toBe('quote_templates')
    expect(variable.validation?.required).toBe(true)
  })
})

describe('the other templates are untouched', () => {
  it('none of them declares a first-party variable, so none gets a creator', () => {
    const others = ['website_lead_follow_up', 'welcome_sequence', 'lost_lead_follow_up', 'contact_form_thank_you', 'appointment_reminder', 'internal_task_on_new_lead']
    for (const key of others) {
      const t = getTemplate(key)!
      expect(t.variables.every((v) => v.type !== 'enum_agency'), `${key} would now render a creator`).toBe(true)
    }
  })

  it('their install still resolves from plain values — no resolver involved', () => {
    const [p] = prepare(getTemplate('internal_task_on_new_lead')!, { taskTitle: 'ליד חדש' })
    expect(p.actionKey).toBe('task.create')
    expect(p.parameters.title).toBe('ליד חדש')
    expect(declaredParameterAnswers(p.actionKey, p.parameters)).toBeNull()
  })
})
