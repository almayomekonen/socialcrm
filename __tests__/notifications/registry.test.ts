import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { NOTIFICATION_REGISTRY, getNotificationType, isEmittableType } from '@/lib/notifications/registry'
import { SLA_PLACEHOLDER_TITLE } from '@/lib/notifications/copy'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  PRIORITIES,
  type EventContext,
  type NotificationType,
} from '@/lib/notifications/types'

/**
 * Registry invariants — spec §5, §22.1.
 *
 * These cover what the type system cannot: that copy is deterministic and
 * model-free, that collapse keys are pure, that a type can only escalate if it
 * can prove it is unhandled, and that deep links never act as capabilities.
 */

const ctx = (over: Partial<EventContext> = {}): EventContext => ({
  type: 'lead.created',
  agencyId: 7,
  entityType: 'lead',
  entityId: 42,
  actorUserId: null,
  occurredAt: new Date('2026-08-11T09:00:00Z'),
  payload: { leadName: 'דניאל כהן', status: 'contacted', provider: 'facebook' },
  groupCount: 1,
  ...over,
})

const entries = Object.values(NOTIFICATION_REGISTRY)
const enabled = entries.filter((e) => e.enabled)

describe('invariant 1 — exactly one entry per type', () => {
  it('every declared type has an entry, and nothing extra exists', () => {
    expect(Object.keys(NOTIFICATION_REGISTRY).sort()).toEqual([...NOTIFICATION_TYPES].sort())
    // Counted from the union rather than a literal, so adding a type cannot make
    // this assertion stale — the previous hard-coded 16 had to be edited by hand.
    expect(entries).toHaveLength(NOTIFICATION_TYPES.length)
  })

  it("each entry's own type field matches its key — a copy/paste guard", () => {
    for (const [key, def] of Object.entries(NOTIFICATION_REGISTRY)) {
      expect(def.type, `${key} declares a different type internally`).toBe(key)
    }
  })

  it('every entry declares a known category, priority and recipient rule', () => {
    for (const def of entries) {
      expect(NOTIFICATION_CATEGORIES).toContain(def.category)
      expect(PRIORITIES).toContain(def.basePriority)
      // 'platform_operator' is the platform-level rule: it resolves to the
      // platform-owner allowlist instead of the agency's users, and is the only
      // rule that may address someone outside the event's tenant.
      expect(['handler_or_admin', 'admin_only', 'platform_operator']).toContain(def.recipients)
    }
  })

  it('the category prefix of a type matches its category field', () => {
    const prefixToCategory: Record<string, string> = {
      lead: 'leads',
      message: 'messages',
      comment: 'messages',
      followup: 'followups',
      integration: 'integrations',
      sla: 'sla',
      // Deliberate reuse, not a mismatch: `notifications.category` carries a
      // database CHECK over exactly five values, so a 'subscription' category
      // would require a migration. An external payment mandate awaiting action
      // is genuinely the integrations bucket, and the mapping is recorded here
      // so the reuse stays intentional rather than looking like a slip.
      subscription: 'integrations',
    }
    for (const def of entries) {
      expect(def.category).toBe(prefixToCategory[def.type.split('.')[0]])
    }
  })
})

describe('invariant 2 — copy is deterministic and model-free', () => {
  it('the same context always produces the same strings', () => {
    for (const def of entries) {
      const a = ctx({ type: def.type })
      const b = ctx({ type: def.type })
      expect(def.title(a)).toBe(def.title(b))
      expect(def.body(a)).toBe(def.body(b))
    }
  })

  it('no copy module imports an AI/model module', () => {
    // The hard rule: a notification states a business fact, so the model must
    // never be in its path (care-charter Law 1).
    for (const file of ['lib/notifications/copy.ts', 'lib/notifications/registry.ts', 'lib/notifications/plan.ts']) {
      const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(src, `${file} reaches an AI module`).not.toMatch(/from '@\/lib\/ai|ai-sdk|generateText|runStructured/)
    }
  })

  it('every enabled type produces a non-empty title', () => {
    for (const def of enabled) expect(def.title(ctx({ type: def.type })).trim().length).toBeGreaterThan(0)
  })

  it('no emoji anywhere in rendered copy (CLAUDE.md §12)', () => {
    const pictographic = /\p{Extended_Pictographic}/u
    for (const def of entries) {
      const c = ctx({ type: def.type })
      expect(pictographic.test(def.title(c)), `${def.type} title has an emoji`).toBe(false)
      expect(pictographic.test(def.body(c) ?? ''), `${def.type} body has an emoji`).toBe(false)
    }
  })

  it('never uses the forbidden vocabulary (CLAUDE.md §6, care-charter Law 8)', () => {
    for (const def of entries) {
      const c = ctx({ type: def.type })
      const text = `${def.title(c)} ${def.body(c) ?? ''}`
      expect(text, `${def.type} uses insurance/CRM-wrong terminology`).not.toMatch(/סוכן|לקוח/)
    }
  })

  it('overdue work is framed as waiting, never as the user failing (Law 13)', () => {
    const title = NOTIFICATION_REGISTRY['followup.overdue'].title(ctx({ type: 'followup.overdue' }))
    expect(title).toContain('ממתין')
    expect(title).not.toMatch(/פספסת|הזנחת|באיחור|איחור/)
  })

  it('a missing name degrades to name-free copy rather than inventing one', () => {
    for (const def of enabled) {
      const nameless = ctx({ type: def.type, payload: { provider: 'facebook' } })
      const title = def.title(nameless)
      expect(title.trim().length).toBeGreaterThan(0)
      // No dangling separator, no placeholder standing in for a real name.
      expect(title).not.toMatch(/—\s*$/)
      expect(title).not.toMatch(/undefined|null|\{|\}/)
    }
  })

  it('the grouped-message title reports the row count it was given', () => {
    const def = NOTIFICATION_REGISTRY['message.inbound_multiple']
    expect(def.title(ctx({ type: 'message.inbound_multiple', groupCount: 4 }))).toContain('4')
    // Never claims "1 message" — the grouped type only exists above one.
    expect(def.title(ctx({ type: 'message.inbound_multiple', groupCount: 1 }))).toContain('2')
  })
})

describe('invariant 3 — escalation requires a resolution predicate (fail-closed)', () => {
  it('no type declares a ladder without a way to prove it is still unhandled', () => {
    for (const def of entries) {
      if (def.escalation) expect(def.isResolved, `${def.type} escalates but cannot check resolution`).toBeTypeOf('function')
    }
  })

  it('P1 ships with no type escalating at all', () => {
    // Escalation is P4. Until the predicates exist, every type stops at level 0.
    for (const def of entries) {
      expect(def.escalation, `${def.type} escalates before P4`).toBeUndefined()
      expect(def.isResolved).toBeUndefined()
    }
  })
})

describe('invariant 4 — disabled types are inert', () => {
  it('exactly the two sla.* types are disabled', () => {
    const disabled = entries.filter((e) => !e.enabled).map((e) => e.type)
    expect(disabled.sort()).toEqual(['sla.approaching', 'sla.breached'])
    expect(isEmittableType('sla.breached')).toBe(false)
    expect(isEmittableType('lead.created')).toBe(true)
  })

  it('the SLA placeholder never leaks into an enabled type', () => {
    // The placeholder exists because SLA has no semantics in this codebase yet;
    // it must never be rendered to a user.
    for (const def of enabled) expect(def.title(ctx({ type: def.type }))).not.toBe(SLA_PLACEHOLDER_TITLE)
  })

  it('no emitter exists for a disabled type anywhere in the source', () => {
    const roots = ['lib', 'db', 'actions', 'app', 'components', 'modules']
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name)) files.push(full)
      }
    }
    for (const root of roots) walk(path.join(process.cwd(), root))

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      if (file.endsWith('registry.ts') || file.endsWith('collapseKeys.ts')) continue
      expect(src, `${file} emits a disabled sla type`).not.toMatch(/type:\s*'sla\.(approaching|breached)'/)
    }
  })
})

describe('collapse keys are pure identities', () => {
  it('do not vary with time — the same work is the same key an hour later', () => {
    for (const def of entries) {
      const early = ctx({ type: def.type, occurredAt: new Date('2026-08-11T09:00:00Z') })
      const late = ctx({ type: def.type, occurredAt: new Date('2026-08-11T10:00:00Z') })
      expect(def.collapseKey(early)).toBe(def.collapseKey(late))
    }
  })

  it('do not vary with the actor', () => {
    for (const def of entries) {
      expect(def.collapseKey(ctx({ type: def.type, actorUserId: 1 }))).toBe(
        def.collapseKey(ctx({ type: def.type, actorUserId: 99 })),
      )
    }
  })

  it('separate different entities, and never embed a notification or job id', () => {
    for (const def of entries) {
      const a = def.collapseKey(ctx({ type: def.type, entityId: 42 }))
      const b = def.collapseKey(ctx({ type: def.type, entityId: 43 }))
      if (def.category !== 'integrations') expect(a).not.toBe(b)
      expect(a).not.toMatch(/notification|jobId/i)
    }
  })

  it('lead arrival, assignment and heat share ONE key — one thing to work (§10.2)', () => {
    const arrival = (type: NotificationType) => NOTIFICATION_REGISTRY[type].collapseKey(ctx({ type, entityId: 42 }))
    expect(arrival('lead.created')).toBe(arrival('lead.assigned'))
    expect(arrival('lead.created')).toBe(arrival('lead.hot'))
    // …but a status change is separate work from the arrival.
    expect(arrival('lead.created')).not.toBe(arrival('lead.status_changed'))
  })

  it('integration health collapses per provider per agency, not per event', () => {
    const def = NOTIFICATION_REGISTRY['integration.disconnected']
    const fb = ctx({ type: 'integration.disconnected', payload: { provider: 'facebook' } })
    const wa = ctx({ type: 'integration.disconnected', payload: { provider: 'whatsapp' } })
    expect(def.collapseKey(fb)).not.toBe(def.collapseKey(wa))
    expect(def.collapseKey(fb)).toContain('7')
  })
})

describe('deep links target entities, never notifications (§20.2)', () => {
  it('every link is an in-app path with no notification id', () => {
    for (const def of entries) {
      const link = def.deepLink(ctx({ type: def.type }))
      expect(link.startsWith('/'), `${def.type} link is not app-relative`).toBe(true)
      expect(link).not.toMatch(/^https?:/)
      expect(link).not.toContain('/notifications/')
      expect(link).not.toMatch(/notificationId|token=/)
    }
  })

  /**
   * Resolve a URL path against the real App Router tree.
   *
   * The predecessor of this test matched links against a hardcoded regex, which
   * made it agree with whatever the registry already said: it passed for a
   * whole phase while every lead link pointed at `/clients/{id}`, a segment that
   * has a layout but no page and therefore 404s. Asking the filesystem is the
   * only version of this assertion that can disagree with the registry.
   *
   * Route groups are transparent to the URL, dynamic segments swallow one
   * literal, and a catch-all swallows the rest — the three rules needed to walk
   * this app's routes.
   */
  function routeExists(segments: string[], dir = path.resolve(__dirname, '..', '..', 'app')): boolean {
    if (segments.length === 0) return fs.existsSync(path.join(dir, 'page.tsx'))

    const [head, ...rest] = segments
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('@')) continue
      const child = path.join(dir, entry.name)

      if (entry.name.startsWith('(') && entry.name.endsWith(')')) {
        if (routeExists(segments, child)) return true // Group: URL unchanged.
        continue
      }
      if (/^\[\.\.\./.test(entry.name)) {
        if (fs.existsSync(path.join(child, 'page.tsx'))) return true
        continue
      }
      if (entry.name === head || /^\[[^.]+\]$/.test(entry.name)) {
        if (routeExists(rest, child)) return true
      }
    }
    return false
  }

  it('links point at routes that actually exist in app/', () => {
    for (const def of entries) {
      const link = def.deepLink(ctx({ type: def.type }))
      const segments = link.split('?')[0].split('/').filter(Boolean)
      expect(routeExists(segments), `${def.type} links to ${link}, which has no page`).toBe(true)
    }
  })

  it('the resolver it relies on can tell a real route from a missing one', () => {
    // Without this, a resolver that returned true for everything would make the
    // test above vacuous — which is the exact failure mode being replaced.
    expect(routeExists(['clients', '42', 'summary'])).toBe(true)
    expect(routeExists(['clients', '42'])).toBe(false) // Layout, no page.
    expect(routeExists(['inbox'])).toBe(true)
    expect(routeExists(['settings', 'integrations'])).toBe(true)
    expect(routeExists(['clients', '42', 'not-a-route'])).toBe(false)
  })

  it('the entity a link targets is the entity the registry declares', () => {
    for (const def of entries) {
      const c = ctx({ type: def.type })
      expect(def.entity(c).id).toBe(c.entityId)
      // Leads and conversations have per-row routes, so the id must appear.
      // Integrations deliberately do not: /settings/integrations is the single
      // page where every external system is connected (there is no per-provider
      // route, and the two old ones are redirect stubs), so the correct
      // destination carries no id.
      // Comments likewise: only /inbox/comments exists (no per-comment URL yet).
      // Subscriptions likewise: the destination is /admin, the platform-owner
      // surface that already lists every agency. There is no per-subscription
      // route, and the notification's reader is the operator, not the tenant.
      const entityType = def.entity(c).type
      if (entityType !== 'integration' && entityType !== 'comment' && entityType !== 'subscription') {
        expect(def.deepLink(c)).toContain(String(def.entity(c).id))
      }
    }
  })
})

describe('registry lookup', () => {
  it('an unknown type resolves to undefined rather than a guess', () => {
    expect(getNotificationType('lead.exploded')).toBeUndefined()
    expect(isEmittableType('lead.exploded')).toBe(false)
  })
})
