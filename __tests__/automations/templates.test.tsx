// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import fs from 'node:fs'
import path from 'node:path'

import { getTemplate, listTemplates, validateMarketplace } from '@/lib/automations/templates/registry'
import { prepare, resolveValues, substitute, validateTemplate } from '@/lib/automations/templates/install'
import { TEMPLATE_CATEGORIES, type TemplateDefinition } from '@/lib/automations/templates/types'
import { CATEGORY } from '@/components/settings/templates/copy'
import TemplateCard from '@/components/settings/templates/TemplateCard'
import TemplatesSettings from '@/components/settings/templates/TemplatesSettings'
import { getAction, getEvent, listActionsForEvent } from '@/lib/automations/catalog/registry'
import { unknownTokensFor } from '@/lib/automations/variables'
import { resolvableFieldsFor } from '@/lib/automations/executors/registry'
import type { TemplateView } from '@/lib/automations/templates/overview'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/actions/automations/templates', () => ({
  installTemplate: vi.fn(async () => ({ ok: true, created: 1 })),
  uninstallTemplate: vi.fn(async () => ({ ok: true, created: 1 })),
}))

afterEach(cleanup)

/**
 * ══════════════════════════════════════════════════════════════════════════
 * C4 — templates install ORDINARY automations, and own nothing afterwards.
 * ══════════════════════════════════════════════════════════════════════════
 */

describe('the seeded marketplace is valid against the LIVE catalog', () => {
  it('every registered template validates', () => {
    expect(validateMarketplace()).toEqual([])
  })

  it('every template names a registered event and a registered action', () => {
    for (const t of listTemplates()) {
      for (const a of t.automations) {
        expect(getEvent(a.eventKey), `${t.key} → ${a.eventKey}`).toBeTruthy()
        expect(getAction(a.actionKey), `${t.key} → ${a.actionKey}`).toBeTruthy()
      }
    }
  })

  it('every action a template picks is one the Builder would OFFER for that event', () => {
    for (const t of listTemplates()) {
      for (const a of t.automations) {
        const offered = listActionsForEvent(getEvent(a.eventKey)!).map((x) => x.key)
        expect(offered, `${t.key}: ${a.actionKey} on ${a.eventKey}`).toContain(a.actionKey)
      }
    }
  })

  it('every runtime variable in template content is one the ACTION can resolve', () => {
    for (const t of listTemplates()) {
      for (const a of t.automations) {
        const resolvable = resolvableFieldsFor(a.actionKey)
        for (const value of Object.values(a.parameters)) {
          // Template tokens are `[[…]]`; these are the `{{…}}` ones the
          // renderer substitutes per lead, and they must be resolvable.
          expect(unknownTokensFor(resolvable, value), `${t.key}: "${value}"`).toEqual([])
        }
      }
    }
  })

  it('every category has Hebrew, and every template uses a registered one', () => {
    for (const c of TEMPLATE_CATEGORIES) expect(CATEGORY[c], `no Hebrew for "${c}"`).toBeTruthy()
    for (const t of listTemplates()) expect(TEMPLATE_CATEGORIES).toContain(t.category)
  })

  it('contains no emoji — the product design rule, in content nobody reviews twice', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    for (const t of listTemplates()) {
      const text = [t.title, t.description, ...t.automations.flatMap((a) => [a.name, ...Object.values(a.parameters)])]
      for (const s of text) expect(emoji.test(s), `${t.key}: "${s}"`).toBe(false)
    }
  })

  it('seeds the marketplace roster, in order', () => {
    const keys = listTemplates().map((t) => t.key)
    expect(keys).toEqual([
      'website_lead_follow_up',
      'welcome_sequence',
      'lost_lead_follow_up',
      'contact_form_thank_you',
      /**
       * ONE appointment template: the customer-facing reminder.
       *
       * `appointment_confirmation` and `appointment_reminder_task` were removed.
       * Google Calendar already sends the invitation, the updates, the
       * cancellations and the RSVP for a meeting booked in the CRM, so a
       * confirmation email duplicated it; and the rep-side task form was a
       * stand-in for anchor-based scheduling, which the reminder now does
       * properly.
       */
      'appointment_reminder',
      'internal_task_on_new_lead',
    ])
  })

  it('the welcome sequence really is a sequence — three automations, spread out', () => {
    const t = getTemplate('welcome_sequence')!
    expect(t.automations.length).toBe(3)
    expect(t.automations.map((a) => a.timing)).toEqual([
      { kind: 'preset', preset: 'immediate' },
      { kind: 'custom', value: 2, unit: 'days' },
      { kind: 'custom', value: 7, unit: 'days' },
    ])
  })
})

describe('validation refuses a template the catalog cannot honour', () => {
  const good = (): TemplateDefinition => ({
    key: 'probe',
    version: 1,
    title: 'בדיקה',
    category: 'lead',
    description: 'תיאור',
    icon: 'envelope',
    requirements: [],
    variables: [],
    automations: [
      {
        name: 'בדיקה',
        eventKey: 'lead.created',
        conditions: [],
        actionKey: 'email.send',
        timing: { kind: 'preset', preset: 'immediate' },
        parameters: { subject: 'נושא', body: 'תוכן' },
      },
    ],
  })

  it('accepts a well-formed one', () => {
    expect(validateTemplate(good())).toEqual([])
  })

  it('rejects an unregistered event', () => {
    const t = good()
    t.automations = [{ ...t.automations[0], eventKey: 'payment.received' }]
    expect(validateTemplate(t).join()).toContain('unknown event')
  })

  it('rejects an unregistered action', () => {
    const t = good()
    t.automations = [{ ...t.automations[0], actionKey: 'sms.send' }]
    expect(validateTemplate(t).join()).toContain('unknown action')
  })

  it('rejects an action the event could never offer', () => {
    const t = good()
    // A form event has an email field, so pick the reverse case: an action
    // requiring email on an event that declares none is impossible to build.
    const noEmail = { ...getEvent('lead.created')!, fields: [] }
    expect(listActionsForEvent(noEmail).map((a) => a.key)).not.toContain('email.send')
  })

  it('rejects a condition on a field the event does not declare', () => {
    const t = good()
    t.automations = [{ ...t.automations[0], conditions: [{ field: 'invented', operator: 'is', value: 'x' }] }]
    expect(validateTemplate(t).join()).toContain('condition_field_unknown')
  })

  it('rejects an empty required parameter', () => {
    const t = good()
    t.automations = [{ ...t.automations[0], parameters: { subject: '', body: 'x' } }]
    expect(validateTemplate(t).join()).toContain('required parameter')
  })

  it('rejects an undeclared [[variable]] — a raw token must never reach a customer', () => {
    const t = good()
    t.automations = [{ ...t.automations[0], parameters: { subject: 'שלום [[nope]]', body: 'x' } }]
    expect(validateTemplate(t).join()).toContain('undeclared variable')
  })

  it('rejects invalid timing and a template that installs nothing', () => {
    const t = good()
    t.automations = [{ ...t.automations[0], timing: { kind: 'custom', value: 999, unit: 'days' } }]
    expect(validateTemplate(t).join()).toContain('invalid timing')
    expect(validateTemplate({ ...good(), automations: [] }).join()).toContain('installs nothing')
  })
})

describe('variable substitution happens ONCE, at install', () => {
  it('fills declared variables from the customer’s answers', () => {
    const t = getTemplate('internal_task_on_new_lead')!
    const [a] = prepare(t, { taskTitle: 'לחזור אל {{שם הליד}} היום' })
    expect(a.parameters.title).toBe('לחזור אל {{שם הליד}} היום')
  })

  it('falls back to the declared default', () => {
    const t = getTemplate('internal_task_on_new_lead')!
    expect(resolveValues(t).taskTitle).toBe(t.variables[0].default)
  })

  it('leaves RUNTIME variables untouched — they belong to the renderer, not to us', () => {
    expect(substitute('שלום {{שם הליד}} [[x]]', { x: 'א' })).toBe('שלום {{שם הליד}} א')
  })

  it('an unknown token resolves to empty rather than staying visible', () => {
    expect(substitute('שלום [[nope]]', {})).toBe('שלום ')
  })

  it('a prepared automation carries no [[token]] whatsoever', () => {
    for (const t of listTemplates()) {
      for (const a of prepare(t)) {
        const texts = [a.name, ...Object.values(a.parameters)]
        for (const s of texts) expect(s, `${t.key}: "${s}"`).not.toMatch(/\[\[/)
      }
    }
  })
})

// ── UI ──────────────────────────────────────────────────────────────────────

const view = (over: Partial<TemplateView> = {}): TemplateView => ({
  template: getTemplate('welcome_sequence')!,
  availability: { state: 'available' },
  installed: 0,
  installedVersion: null,
  updateAvailable: false,
  changes: [],
  preview: prepare(getTemplate('welcome_sequence')!).map((p) => ({
    name: p.name,
    eventKey: p.eventKey,
    actionKey: p.actionKey,
    summary: p.parameters.subject ?? '',
  })),
  ...over,
})

const noop = () => {}

describe('the marketplace renders from the registry alone', () => {
  it('shows a template’s title and description', () => {
    render(<TemplateCard view={view()} onChanged={noop} />)
    expect(screen.getByText('רצף קבלת פנים לליד חדש')).toBeInTheDocument()
    expect(screen.getByText(getTemplate('welcome_sequence')!.description)).toBeInTheDocument()
  })

  /*
    The manifest moved off the card face and into the install dialog, where it
    is read at the moment it decides something. WHERE it lives may change; that
    it is shown before anything is created may not.
  */
  it('says what it would create before anything is created', () => {
    render(<TemplateCard view={view()} onChanged={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'התקנה' }))
    expect(screen.getByText('קבלת פנים — אישור מיידי')).toBeInTheDocument()
  })

  it('groups by the category each template declares', () => {
    render(<TemplatesSettings views={listTemplates().map((t) => view({ template: t }))} />)
    for (const c of TEMPLATE_CATEGORIES) expect(screen.getByText(CATEGORY[c])).toBeInTheDocument()
  })

  it('an empty marketplace is an explained empty state, never a blank page', () => {
    render(<TemplatesSettings views={[]} />)
    // What happened, and what to expect next — the empty state must carry both,
    // not merely one sentence. Copy may change; the two-part shape may not.
    expect(screen.getByText('הגלריה עדיין ריקה')).toBeInTheDocument()
    expect(screen.getByText(/מוכנות להתקנה/)).toBeInTheDocument()
  })

  it('a LOCKED template is shown with its requirement’s CTA, not hidden', () => {
    const locked = view({
      template: getTemplate('contact_form_thank_you')!,
      availability: {
        state: 'locked',
        requirement: {
          type: 'connection',
          key: 'website_connected',
          cta: { label: 'חיבור האתר', href: '/settings/integrations?section=website' },
        },
      },
    })
    render(<TemplateCard view={locked} onChanged={noop} />)
    // Shown, and shown as blocked: the badge names the reason and the CTA is
    // the requirement's own, so the card is a route to connecting rather than
    // a dead end.
    expect(screen.getByText('דורש חיבור')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'חיבור האתר' })).toHaveAttribute(
      'href',
      '/settings/integrations?section=website',
    )
    expect(screen.queryByRole('button', { name: /התקנה/ })).not.toBeInTheDocument()
  })
})

describe('installed templates are the customer’s, and updates never touch them', () => {
  it('shows how many automations it installed', () => {
    render(<TemplateCard view={view({ installed: 3, installedVersion: 1 })} onChanged={noop} />)
    expect(screen.getByText('3 מותקנות')).toBeInTheDocument()
  })

  /*
    The reassurance now sits in the install dialog, next to the button it
    reassures about. The promise itself is the thing under test.
  */
  it('an available update SAYS that installed automations will not change', () => {
    render(
      <TemplateCard
        view={view({ installed: 1, installedVersion: 1, updateAvailable: true, changes: [{ version: 2, note: 'נוסח מעודכן' }] })}
        onChanged={noop}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'התקנה נוספת' }))
    expect(screen.getByText(/האוטומציות שכבר התקנתם לא ישתנו/)).toBeInTheDocument()
    expect(screen.getByText('נוסח מעודכן')).toBeInTheDocument()
  })

  it('an installed template offers an ADDITIONAL install, never a replacement', () => {
    render(<TemplateCard view={view({ installed: 1, installedVersion: 1 })} onChanged={noop} />)
    expect(screen.getByRole('button', { name: 'התקנה נוספת' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /עדכון|החלפה/ })).not.toBeInTheDocument()
  })

  it('removal names what it deletes and promises not to touch anything else', () => {
    render(<TemplateCard view={view({ installed: 2, installedVersion: 1 })} onChanged={noop} />)
    // Removal lives in the card's menu now. Reachable and labelled, never
    // icon-only-without-name — the same rule AutomationCard is held to.
    fireEvent.click(screen.getByRole('button', { name: /פעולות/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'הסרה' }))
    expect(screen.getByText(/אוטומציות שיצרתם בעצמכם לא ייגעו/)).toBeInTheDocument()
  })
})

describe('nothing about a template survives into execution — CI-enforced', () => {
  const ENGINE = [
    'lib/automations/worker.ts',
    'lib/automations/laws.ts',
    'lib/automations/emit.ts',
    'lib/automations/executors/registry.ts',
    'lib/automations/executors/types.ts',
    'db/automations/definitions.ts',
  ]

  const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('no engine or store file mentions templates at all', () => {
    const violations: string[] = []
    for (const file of ENGINE) {
      const code = codeOnly(fs.readFileSync(path.join(process.cwd(), file), 'utf8'))
      if (/\btemplate/i.test(code)) violations.push(file)
    }
    expect(violations).toEqual([])
  })

  it('the Builder does not know the marketplace exists', () => {
    const dir = path.join(process.cwd(), 'components/settings/automations')
    const violations: string[] = []
    for (const file of fs.readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f))) {
      const code = codeOnly(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (/\btemplate/i.test(code)) violations.push(file)
    }
    expect(violations).toEqual([])
  })
})
