import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TRIGGER_TYPES } from '@/lib/automations/types'

/**
 * ONE BUSINESS ACTION → ONE EVENT → ONE PIPELINE.
 *
 * The defect that produced this file: Close Deal moved a lead to Customers by
 * writing `lead = false` and emitted nothing, while the status control wrote
 * `status = 'closed'` and emitted `status_changed`. Two code paths, one business
 * action, different automation behaviour — and an automation configured for
 * "status changed → closed" that never ran for the action that closes deals.
 *
 * These assertions are structural, so the next surface that writes a lead's
 * status or moves it between Leads and Customers cannot quietly bypass the
 * engine. They are deliberately written against the SOURCE TREE rather than
 * against behaviour: a bypass is the absence of a call, and absence is exactly
 * what a behavioural test cannot see.
 */

const ROOTS = ['actions', 'lib', 'db', 'app', 'components']
const files: string[] = []
const walk = (dir: string) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && !entry.startsWith('.')) walk(full)
    } else if (/\.tsx?$/.test(entry)) files.push(full)
  }
}
for (const root of ROOTS) walk(root)

const read = (f: string) => readFileSync(f, 'utf8')

describe('the status_changed event has exactly one shape', () => {
  /**
   * Three surfaces write a lead's status. All three must route through
   * `emitLeadStatusChanged`, so the event they produce cannot drift apart.
   */
  const STATUS_WRITERS = ['actions/clients.ts', 'actions/leadOutcome.ts', 'actions/saleForm.ts']

  it('every status-writing surface routes through the shared emitter', () => {
    for (const f of STATUS_WRITERS) {
      expect(read(f), `${f} does not emit a lead status change`).toContain('emitLeadStatusChanged')
    }
  })

  it('no surface hand-builds a status_changed event any more', () => {
    // The literal is what drifted. Only the shared emitter may contain it.
    const offenders = files.filter(
      (f) => !f.endsWith('lib/automations/statusChanged.ts') && /trigger:\s*'status_changed'/.test(read(f)),
    )
    expect(offenders, 'a hand-built status_changed event can drift from the shared one').toEqual([])
  })

  it('the shared emitter is the only place the trigger literal lives', () => {
    const src = read('lib/automations/statusChanged.ts')
    expect(src).toContain("trigger: 'status_changed'")
    // It must go through the engine's only door, not reach the queue directly.
    expect(src).toContain('emitAutomationEvent')
    expect(src).not.toContain('enqueueAutomationJob')
  })
})

describe('Close Deal reaches the engine', () => {
  const src = read('actions/saleForm.ts')

  it('writes the closed status, so the lead and the Customers view agree', () => {
    expect(src).toContain("const CLOSED_STATUS = 'closed'")
    expect(src).toContain('patch.status = CLOSED_STATUS')
    // The same companion fields updateLead writes, so downstream readers behave
    // identically however the status was reached.
    expect(src).toContain('patch.statusChangedAt')
    expect(src).toContain('patch.lastActivityAt')
  })

  it('still performs the customer transfer, unconditionally', () => {
    expect(src).toContain('lead: false')
  })

  it('emits inside the sale transaction, so a rollback enqueues nothing', () => {
    expect(src).toMatch(/emitLeadStatusChanged\(\{[\s\S]*?trx,[\s\S]*?\}\)/)
  })

  it('does not re-emit when the lead is already closed', () => {
    // Re-saving a sale must not manufacture a second status change.
    expect(src).toContain('before.status !== CLOSED_STATUS')
  })

  it('preserves the sale and commission writes', () => {
    for (const kept of ["trx('sales')", 'insertSaleUsers', 'calculateCommission', 'db.transaction']) {
      expect(src, `Close Deal lost ${kept}`).toContain(kept)
    }
  })
})

describe('moving a lead to Customers has exactly one code path', () => {
  it('only the sale flow writes lead = false', () => {
    const offenders = files.filter((f) => /\blead:\s*false\b/.test(read(f)) && !f.endsWith('actions/saleForm.ts'))
    expect(offenders, 'a second path to Customers would bypass the status change').toEqual([])
  })
})

describe('no surface writes a lead status behind the engine', () => {
  /**
   * A literal lead-status assignment outside the audited writers is the shape a
   * future bypass would take. `'new'` on creation is legitimate — a lead is born
   * with it and `lead_created` covers that moment.
   */
  const ALLOWED = new Set([
    'actions/clients.ts', // updateLead (emits) + creation defaults
    'actions/leadOutcome.ts', // outcome (emits)
    'actions/saleForm.ts', // Close Deal (emits)
    'lib/automations/connectors/contactForm7.ts', // creation default, emits lead_created
    'lib/system/createClientFromWebhook.ts', // creation default, emits lead_created
    'lib/system/createLeadFromWhatsappWebhook.ts', // creation default, emits lead_created
  ])

  it('every lead-status writer is an audited, emitting surface', () => {
    const offenders = files.filter((f) => {
      if (ALLOWED.has(f)) return false
      const src = read(f)
      // Assignments into a lead patch, not comparisons or catalog vocabulary.
      return /\bstatus:\s*'(contacted|interested|closed|lost)'/.test(src)
    })
    expect(offenders, 'this surface changes a lead status without reaching the engine').toEqual([])
  })
})

describe('emission is centralised', () => {
  it('nothing enqueues a job except the engine itself', () => {
    const offenders = files.filter(
      (f) => /enqueueAutomationJob\s*\(/.test(read(f)) && !f.endsWith('lib/automations/emit.ts') && !f.endsWith('db/automations/jobs.ts'),
    )
    expect(offenders, 'a caller reaching the queue directly skips every gate').toEqual([])
  })

  it('every emitted trigger is a registered engine trigger', () => {
    /**
     * Scoped to files that reach the CUSTOMER-automation engine. `lib/emailAutomations`
     * is System A — the platform's own lifecycle email — and has an unrelated
     * `trigger` field of its own. The two systems must never be conflated, which
     * is the same boundary spec §0 draws.
     */
    const emitted = new Set<string>()
    for (const f of files) {
      if (f.startsWith('lib/emailAutomations/')) continue
      const src = read(f)
      if (!/emitAutomationEvent|emitLeadStatusChanged|MappedEvent/.test(src)) continue
      for (const m of src.matchAll(/trigger:\s*'([a-z_]+)'/g)) emitted.add(m[1])
    }
    for (const t of emitted) {
      expect(TRIGGER_TYPES as readonly string[], `"${t}" is emitted but not a registered trigger`).toContain(t)
    }
    expect(emitted.size).toBeGreaterThan(0)
  })

  it('imports remain deliberately inert', () => {
    // ADR-004: an import is a backfill, not a business moment. Enforced twice —
    // at the call site AND unconditionally in the engine.
    expect(read('actions/clients.ts')).toContain("origin === 'import' ? 'import' : 'manual'")
    expect(read('lib/automations/emit.ts')).toContain("if (event.origin === 'import') return { blocked: 'origin_import' }")
  })
})
