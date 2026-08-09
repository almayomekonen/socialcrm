import { describe, expect, it, vi } from 'vitest'
import { validateEvent } from '@/lib/automations/catalog/validate'
import { FIRST_PARTY_SOURCES, PARAMETER_TYPES } from '@/lib/automations/catalog/vocabularies'
import { firstPartyOptionsFor, isFirstPartySource, registeredFirstPartySources } from '@/lib/automations/firstPartyOptions'
import { needsConnection, sourceIdsFrom } from '@/lib/automations/binding'
import type { EventDefinition, ParameterDefinition } from '@/lib/automations/catalog/types'

/**
 * THE FIRST-PARTY PARAMETER PRIMITIVE.
 *
 * `enum_agency` selects from the agency's OWN data — no connection, no
 * capability, no connector. It is a distinct type rather than a flavour of
 * `enum_remote` because three existing consumers branch on the type, and one of
 * them (`binding.ts`) writes `enum_remote` answers into the connection binding.
 * These tests pin both halves: that the new type works, and that it is
 * structurally excluded from that binding.
 */

const SUBJECTS = ['lead']

const eventWith = (parameters: ParameterDefinition[]): EventDefinition =>
  ({
    key: 'lead.created',
    origin: 'internal',
    subject: 'lead',
    title: 'ליד חדש',
    description: 'תיאור',
    icon: 'user',
    lifecycle: 'stable',
    requirements: [],
    parameters,
    fields: [],
    identity: { occurrenceKey: 'lead_created', leadResolution: 'the lead itself' },
  }) as EventDefinition

const param = (over: Partial<ParameterDefinition> = {}): ParameterDefinition =>
  ({ key: 'quoteTemplateId', type: 'enum_agency', label: 'הצעת המחיר', optionSource: 'quote_templates', ...over }) as ParameterDefinition

const messages = (issues: { message: string }[]) => issues.map((i) => i.message).join(' | ')

describe('1 — the vocabulary', () => {
  it('enum_agency is a registered parameter type', () => {
    expect(PARAMETER_TYPES).toContain('enum_agency')
  })

  it('the existing types are untouched and still first — append-only in practice', () => {
    expect([...PARAMETER_TYPES]).toEqual([
      'text',
      'number',
      'boolean',
      'date',
      'enum_static',
      'enum_remote',
      'reference',
      'enum_agency',
    ])
  })

  it('every declared source has a loader, and every loader a declared source', () => {
    // `Record<FirstPartySource, …>` makes the first direction a compile error;
    // this proves the second and pins the pair for a reader.
    expect([...registeredFirstPartySources()].sort()).toEqual([...FIRST_PARTY_SOURCES].sort())
  })
})

describe('2 — catalog validation', () => {
  it('accepts a well-formed enum_agency parameter', () => {
    expect(validateEvent(eventWith([param()]), SUBJECTS)).toEqual([])
  })

  it('rejects enum_agency with no optionSource', () => {
    const issues = validateEvent(eventWith([param({ optionSource: undefined })]), SUBJECTS)
    expect(messages(issues)).toContain('enum_agency requires optionSource')
  })

  it('rejects an UNKNOWN first-party source — a typo fails the build, not the customer', () => {
    const issues = validateEvent(eventWith([param({ optionSource: 'quote_templatez' })]), SUBJECTS)
    expect(messages(issues)).toContain('unknown first-party source "quote_templatez"')
  })

  it('still rejects optionSource on a type that cannot use it', () => {
    const issues = validateEvent(eventWith([param({ type: 'text', optionSource: 'quote_templates' })]), SUBJECTS)
    expect(messages(issues)).toContain('optionSource is only meaningful for')
  })
})

describe('3 — binding safety: a first-party answer is NOT a connector Source', () => {
  it('enum_agency never enters sourceIds', () => {
    // THE REGRESSION THIS PINS. `sourceIds` is the connection binding; writing a
    // quote-template id into it would record the automation as bound to a Source
    // that does not exist. The exclusion is structural — binding.ts filters
    // `type === 'enum_remote'` and simply does not match this type.
    const event = eventWith([param()])
    expect(sourceIdsFrom(event, { quoteTemplateId: '42' })).toEqual([])
  })

  it('an enum_remote answer still DOES enter sourceIds — existing behaviour unchanged', () => {
    const event = eventWith([param({ key: 'formId', type: 'enum_remote', optionSource: 'forms' })])
    expect(sourceIdsFrom(event, { formId: 'form_7' })).toEqual(['form_7'])
  })

  it('a mixed event contributes only its connection-backed answer', () => {
    const event = eventWith([param(), param({ key: 'formId', type: 'enum_remote', optionSource: 'forms' })])
    expect(sourceIdsFrom(event, { quoteTemplateId: '42', formId: 'form_7' })).toEqual(['form_7'])
  })

  it('an event with only first-party parameters needs NO connection', () => {
    // Otherwise the Builder would gate configuration on a connection that can
    // never be satisfied, because there is nothing to connect.
    expect(needsConnection(eventWith([param()]))).toBe(false)
    expect(needsConnection(eventWith([param({ key: 'formId', type: 'enum_remote', optionSource: 'forms' })]))).toBe(true)
  })
})

describe('4 — quote_templates resolves through the quote domain', () => {
  it('maps active templates to generic {id,label} pairs', async () => {
    vi.resetModules()
    vi.doMock('@/db/quotes/templates', () => ({
      listQuoteTemplatesSystem: vi.fn(async (agencyId: number) =>
        agencyId === 7 ? [{ id: 3, name: 'בניית אתר' }, { id: 5, name: 'ליווי חודשי' }] : [],
      ),
    }))
    const { firstPartyOptionsFor: scoped } = await import('@/lib/automations/firstPartyOptions')
    expect(await scoped(7, 'quote_templates')).toEqual([
      { id: '3', label: 'בניית אתר' },
      { id: '5', label: 'ליווי חודשי' },
    ])
    vi.doUnmock('@/db/quotes/templates')
    vi.resetModules()
  })

  it('is agency-scoped — the caller cannot read another tenant’s templates', async () => {
    vi.resetModules()
    const listSpy = vi.fn(async () => [])
    vi.doMock('@/db/quotes/templates', () => ({ listQuoteTemplatesSystem: listSpy }))
    const { firstPartyOptionsFor: scoped } = await import('@/lib/automations/firstPartyOptions')
    await scoped(7, 'quote_templates')
    expect(listSpy).toHaveBeenCalledWith(7)
    vi.doUnmock('@/db/quotes/templates')
    vi.resetModules()
  })

  it('an unregistered source resolves to nothing rather than guessing (Law 3)', async () => {
    expect(await firstPartyOptionsFor(7, 'pipeline_stages')).toEqual([])
    expect(await firstPartyOptionsFor(7, '')).toEqual([])
  })

  it('a non-tenant resolves to nothing', async () => {
    expect(await firstPartyOptionsFor(0, 'quote_templates')).toEqual([])
    expect(await firstPartyOptionsFor(-1, 'quote_templates')).toEqual([])
  })

  it('isFirstPartySource is the closed-set gate the Server Action uses', () => {
    expect(isFirstPartySource('quote_templates')).toBe(true)
    expect(isFirstPartySource('quote_templatez')).toBe(false)
    expect(isFirstPartySource('')).toBe(false)
    expect(isFirstPartySource(null)).toBe(false)
    expect(isFirstPartySource(42)).toBe(false)
  })
})

describe('5 — the dependency arrow points one way only', () => {
  const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('the quote domain imports nothing from the automation layer', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const offenders: string[] = []
    for (const root of ['db/quotes', 'lib/quotes']) {
      const dir = path.join(process.cwd(), root)
      for (const file of fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
        const code = codeOnly(fs.readFileSync(path.join(dir, file), 'utf8'))
        if (/from\s+['"]@\/(lib|db)\/automations/.test(code)) offenders.push(`${root}/${file}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the Server Action refuses an arbitrary source key before reading anything', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const code = fs.readFileSync(path.join(process.cwd(), 'actions/automations/firstPartyOptions.ts'), 'utf8')
    expect(code).toContain("'use server'")
    expect(code).toContain('requireProductAccess')
    // Closed-set check, and the tenant comes from the session — never the wire.
    expect(code).toContain('isFirstPartySource(optionSource)')
    expect(code).toContain('user.agencyId')
    expect(/agencyId\s*[:,)]\s*(input|args)/.test(code)).toBe(false)
  })
})
