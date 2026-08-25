/**
 * Phase-2 substrate — contract and boundary tests (no DB, no model).
 *
 * The behavioural guarantees are proven against real PostgreSQL in
 * __tests__/runtime/signalJobs.test.ts. What is proven HERE is what a database
 * cannot answer: that the identity function is pure, that the claim SQL keeps
 * its concurrency clauses, that the migration keeps its uniqueness and tenant
 * CHECK, and that nothing in the substrate can reach a model, the notification
 * lifecycle, or CRM business state.
 *
 * Runs under `test:unit` (VITEST_NO_DB=1).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { observationKeyFor, expectationOf, UnidentifiableSignalError } from '@/lib/ai/integration/observationKey'
import { DETECTORS, DETECTOR_LIST } from '@/lib/ai/integration/detectors/registry'
import { detectFollowupOverdue } from '@/lib/ai/integration/detectors/followupOverdue'
import { businessDayBounds } from '@/lib/today/time'
import type { ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'
import type { LeadFact } from '@/lib/today/types'

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * The CODE of a module, with comments removed.
 *
 * These files document what they must never do — "never `Date.now()`", "as
 * `notification_jobs` already does beside it" — so a scanner run over raw text
 * flags the prose that exists to prevent the very thing it is looking for. The
 * boundary being asserted is about what the module DOES, so the assertions read
 * what it does.
 */
function codeOf(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
}

const NOW = new Date('2026-08-25T09:00:00.000Z')
const ctx = businessDayBounds(NOW.getTime())
const DAY = 86_400_000

const SUBSTRATE = ['db/ai/signalJobs.ts', 'lib/ai/integration/signalWorker.ts', 'lib/ai/integration/observationKey.ts']
const MIGRATION = 'migrations/20260825000002_create_signal_jobs.cjs'

function signal(leadId = 77, daysOverdue = 2, agencyId = 103): ExternalSignal {
  const fact: LeadFact = {
    id: leadId,
    name: null,
    phone: null,
    status: 'contacted',
    leadSource: 'manual',
    createdAt: ctx.nowMs - 30 * DAY,
    nextFollowUpAt: ctx.dayStart - daysOverdue * DAY,
    lastActivityAt: ctx.nowMs - 5 * DAY,
    lastInboundAt: null,
    lastHumanOutboundAt: null,
    hasOpenTask: false,
    earliestOpenTaskDueAt: null,
  }
  return detectFollowupOverdue([fact], ctx, { agencyId })[0]
}

// ── deterministic identity ───────────────────────────────────────────────────

describe('observation identity is deterministic and pure', () => {
  it('is stable across calls and independent of the detection instant', () => {
    const a = signal()
    const b = { ...signal(), occurredAt: new Date(NOW.getTime() + 9 * 3_600_000).toISOString() }
    expect(observationKeyFor(a)).toBe(observationKeyFor(a))
    expect(observationKeyFor(b)).toBe(observationKeyFor(a))
  })

  it('namespaces by expectation, subject and the moment the expectation named', () => {
    const s = signal()
    expect(observationKeyFor(s)).toBe(`followup.overdue:lead:77:at:${s.absence!.expectedBy}`)
    expect(expectationOf(s)).toBe('followup.overdue')
  })

  it('different subjects and different deadlines are different observations', () => {
    expect(observationKeyFor(signal(77))).not.toBe(observationKeyFor(signal(78)))
    expect(observationKeyFor(signal(77, 2))).not.toBe(observationKeyFor(signal(77, 9)))
  })

  it('the same observation in two agencies has the same key — the index carries the tenant', () => {
    expect(observationKeyFor(signal(77, 2, 103))).toBe(observationKeyFor(signal(77, 2, 104)))
    expect(read(MIGRATION)).toContain('ON signal_jobs ("agencyId", "observationKey")')
  })

  it('refuses to guess an identity it cannot derive', () => {
    expect(() => observationKeyFor({ ...signal(), subject: undefined })).toThrow(UnidentifiableSignalError)
    expect(() => observationKeyFor({ ...signal(), absence: { violatedExpectation: 'x' } })).toThrow(UnidentifiableSignalError)
    expect(() => expectationOf({ ...signal(), absence: undefined })).toThrow(UnidentifiableSignalError)
  })

  it('never reads a clock or a random source', () => {
    const code = codeOf('lib/ai/integration/observationKey.ts')
    expect(code).not.toMatch(/Date\.now\(\)/)
    expect(code).not.toMatch(/Math\.random/)
    expect(code).not.toMatch(/new Date\(\)/)
  })
})

// ── the proven concurrency pattern, kept ─────────────────────────────────────

describe('signal_jobs claim contract', () => {
  const src = read('db/ai/signalJobs.ts')

  it('claims only pending work that is due, oldest first', () => {
    expect(src).toContain(`status = 'pending' AND "nextAttemptAt" <= now()`)
    expect(src).toContain('ORDER BY "nextAttemptAt" ASC, id ASC')
  })

  it('leases with FOR UPDATE SKIP LOCKED — the property that makes workers safe', () => {
    expect(src).toContain('FOR UPDATE SKIP LOCKED')
  })

  it('takes the attempt at the claim, so a crashed worker still consumes one', () => {
    expect(src).toContain('attempts = attempts + 1')
    expect(src).toContain(`SET status = 'leased', "lockedAt" = now(), "lockedBy" = ?`)
  })

  it('retries with backoff and dead-letters at the attempts budget', () => {
    expect(src).toContain(`CASE WHEN attempts >= "maxAttempts" THEN 'dead' ELSE 'pending' END`)
    expect(src).toContain('make_interval(secs => LEAST(POWER(2, LEAST(attempts, 10))::int, 900))')
  })

  it('completes only while still leased, so a reclaimed job cannot complete twice', () => {
    expect(src).toContain(`.where({ id, status: 'leased' })`)
  })

  it('reclaims expired leases without refunding attempts', () => {
    expect(src).toContain(`WHERE status = 'leased' AND "lockedAt" < ?`)
    expect(src).toContain(`"lastError" = 'lease-expired-reclaimed'`)
    // Scoped to reclaimStaleSignalJobs, not the whole file. Phase 4.3 added
    // `releaseSignalJobClaim`, which DOES give an attempt back — deliberately,
    // because a capacity refusal examined nothing. The invariant that matters is
    // unchanged and is what this asserts: an EXPIRED LEASE is a real attempt and
    // is never refunded.
    const from = src.indexOf('export async function reclaimStaleSignalJobs')
    const reclaim = src.slice(from, src.indexOf('export async function', from + 1))
    expect(reclaim).not.toMatch(/attempts\s*=\s*GREATEST\(attempts - 1/)
  })

  it('releases an unexamined claim WITHOUT consuming an attempt', () => {
    const release = src.slice(src.indexOf('export async function releaseSignalJobClaim'))
    expect(release).toMatch(/attempts = GREATEST\(attempts - 1, 0\)/)
    expect(release).toContain(`WHERE id = ? AND status = 'leased'`)
    // It never kills a job: nothing that was never examined can be exhausted.
    expect(release).not.toContain(`'dead'`)
  })

  it('enqueues idempotently', () => {
    expect(src).toContain('ON CONFLICT ("agencyId","observationKey") DO NOTHING')
  })
})

describe('signal_jobs migration contract', () => {
  const sql = read(MIGRATION)

  it('one job per observation, across every status', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS signal_jobs_observation_uniq')
    expect(sql).toContain('ON signal_jobs ("agencyId", "observationKey")')
    // Not a partial index: a processed observation stays known.
    const idx = sql.slice(sql.indexOf('signal_jobs_observation_uniq'))
    expect(idx.slice(0, 160)).not.toContain('WHERE status')
  })

  it('enforces the tenant boundary in storage', () => {
    expect(sql).toContain('CONSTRAINT signal_jobs_agency_matches_signal')
    expect(sql).toContain(`CHECK ((signal->'scope'->>'agencyId') IS NOT DISTINCT FROM ("agencyId")::text)`)
  })

  it('holds the required lifecycle vocabulary and no more', () => {
    expect(sql).toContain(`CHECK (status IN ('pending','leased','succeeded','dead'))`)
  })

  it('carries the full lease, attempt and backoff columns', () => {
    for (const col of [
      'attempts',
      '"maxAttempts"',
      '"nextAttemptAt"',
      '"lockedAt"',
      '"lockedBy"',
      '"lastError"',
      '"completedAt"',
      '"createdAt"',
      '"updatedAt"',
    ]) {
      expect(sql).toContain(col)
    }
  })

  it('stores the signal payload as jsonb, sufficient to reconstruct the ExternalSignal', () => {
    expect(sql).toContain('signal jsonb NOT NULL')
  })

  it('is reversible', () => {
    expect(sql).toContain('exports.down')
    expect(sql).toContain('DROP TABLE IF EXISTS signal_jobs')
  })

  it('is the only Phase-2 migration, and its DDL touches one table', () => {
    const phase2 = readdirSync(join(ROOT, 'migrations')).filter((f) => f.startsWith('20260825000002'))
    expect(phase2).toEqual(['20260825000002_create_signal_jobs.cjs'])

    const ddl = codeOf(MIGRATION)
    const touched = new Set(
      [
        ...ddl.matchAll(
          /(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE|DROP TABLE(?: IF EXISTS)?|INSERT INTO|UPDATE|ON)\s+([a-z_]+)/g,
        ),
      ]
        .map((m) => m[1])
        .filter((t) => t !== 'signal_jobs'),
    )
    expect([...touched]).toEqual([])
  })
})

// ── L. followupOverdue remains the only wired detector ───────────────────────

describe('L · every wired detector is declared across all five registries', () => {
  it('the registry and the iteration list agree exactly', () => {
    expect(DETECTOR_LIST).toHaveLength(Object.keys(DETECTORS).length)
    expect(DETECTOR_LIST.map((d) => d.expectation).sort()).toEqual(Object.keys(DETECTORS).sort())
  })

  it('every detector module on disk is wired into the registry, and nothing else is', () => {
    // Phase 4.5 added a second detector. The invariant that matters was never
    // "there is one file" — it is that a module sitting in this directory is
    // either registered or does not exist, so an orphaned detector cannot lurk
    // unwired and an unregistered expectation cannot reach the sweep.
    const files = readdirSync(join(ROOT, 'lib/ai/integration/detectors'))
      .filter((f) => f.endsWith('.ts') && f !== 'registry.ts')
      .sort()
    expect(files).toEqual(['followupOverdue.ts', 'openLoopSla.ts'])
    expect(files).toHaveLength(Object.keys(DETECTORS).length)
  })

  it('Phase 2 added no detector of its own', () => {
    for (const rel of SUBSTRATE) {
      expect(read(rel)).not.toMatch(/detect[A-Z]\w*\s*\(/)
    }
  })
})

// ── N. no notification writes ────────────────────────────────────────────────

describe('N · the substrate never touches the notification lifecycle', () => {
  it('imports nothing from the notification engine', () => {
    for (const rel of SUBSTRATE) {
      const src = read(rel)
      expect(src, rel).not.toMatch(/from '@\/lib\/notifications/)
      expect(src, rel).not.toMatch(/from '@\/db\/notifications/)
      expect(src, rel).not.toContain('notifyEvent')
      expect(src, rel).not.toContain('enqueueNotificationJob')
    }
  })

  it('names no notification table in code', () => {
    for (const rel of [...SUBSTRATE, MIGRATION]) {
      const code = codeOf(rel)
      expect(code, rel).not.toContain('notification_jobs')
      expect(code, rel).not.toMatch(/\bnotifications\b/)
    }
  })
})

// ── O. no CRM business-state writes ──────────────────────────────────────────

describe('O · the substrate writes no CRM business state', () => {
  const BUSINESS_TABLES = [
    'clients',
    'tasks',
    'inbox_messages',
    'inbox_conversations',
    'users',
    'agencies',
    'user_perms',
    'auto_response_jobs',
    'lead_status_transitions',
  ]

  it('names no CRM business table in any SQL or query-builder position', () => {
    for (const rel of SUBSTRATE) {
      const code = codeOf(rel)
      for (const table of BUSINESS_TABLES) {
        const positions = new RegExp(`(?:FROM|JOIN|INTO|UPDATE|DELETE FROM|TABLE)\\s+${table}\\b|['"\`]${table}['"\`]`, 'i')
        expect(positions.test(code), `${rel} references ${table} in a query position`).toBe(false)
      }
    }
  })

  it('writes only to signal_jobs and the isolated shadow coverage sink', () => {
    const writes = new Set<string>()
    for (const rel of SUBSTRATE) {
      const src = read(rel)
      for (const m of src.matchAll(/(?:INSERT INTO|UPDATE)\s+([a-z_]+)/g)) writes.add(m[1])
      for (const m of src.matchAll(/db\(['"]([a-z_]+)['"]\)/g)) writes.add(m[1])
      for (const m of src.matchAll(/exec(?:utor)?\(['"]([a-z_]+)['"]\)/g)) writes.add(m[1])
    }
    expect([...writes].sort()).toEqual(['signal_jobs'])
  })

  it('the only other persistence is recordCoverageDecision — an audit sink, not business state', () => {
    const worker = read('lib/ai/integration/signalWorker.ts')
    expect(worker).toContain('recordCoverageDecision')
    expect(worker).not.toMatch(/\.insert\(/)
    expect(worker).not.toMatch(/\.update\(/)
    expect(worker).not.toMatch(/\.del\(/)
  })
})

// ── M. no provider / LLM anywhere in the Phase-2 closure ─────────────────────

describe('M · no provider is reachable from the Phase-2 substrate', () => {
  const SEEDS = [
    ...SUBSTRATE,
    'lib/ai/integration/detectors/registry.ts',
    'lib/ai/integration/detectors/followupOverdue.ts',
    'lib/ai/runtime/eventInterpretation.ts',
    'lib/ai/runtime/scheduler.ts',
    'lib/ai/runtime/reasoning.ts',
    'lib/ai/runtime/toolAction.ts',
  ]

  const PROVIDER_SPECIFIERS = [
    /^ai$/,
    /^@ai-sdk\//,
    /openai/i,
    /anthropic/i,
    /^@\/lib\/ai\/router/,
    /^@\/lib\/ai\/providers/,
    /^@\/lib\/ai\/gate$/,
    /^@\/lib\/agent\//,
  ]

  function importsOf(rel: string): string[] {
    const src = read(rel)
    return [...src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
  }

  function resolveLocal(spec: string, fromRel: string): string | null {
    let base: string
    if (spec.startsWith('@/')) base = spec.slice(2)
    else if (spec.startsWith('.')) base = join(fromRel, '..', spec).replace(/^\/+/, '')
    else return null
    for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (existsSync(join(ROOT, cand))) return cand
    }
    return null
  }

  it('no module in the closure imports a model, an SDK, or the AI router', () => {
    const seen = new Set<string>()
    const queue = [...SEEDS]
    const violations: string[] = []

    while (queue.length > 0) {
      const rel = queue.shift() as string
      if (seen.has(rel)) continue
      seen.add(rel)
      for (const spec of importsOf(rel)) {
        if (PROVIDER_SPECIFIERS.some((re) => re.test(spec))) violations.push(`${rel} → ${spec}`)
        const local = resolveLocal(spec, rel)
        if (local && (local.startsWith('lib/ai/') || local.startsWith('lib/today/') || local.startsWith('db/ai/'))) {
          queue.push(local)
        }
      }
    }

    /**
     * PHASE 4.3 — the boundary moved, deliberately and in exactly one place.
     *
     * `@/lib/agent/types` is a pure type module (it imports only `@/types/roles`
     * and `@/lib/quota/types`), so reaching it is not reaching a provider.
     *
     * `@/lib/agent/run` IS the provider reach, and it is authorized: the
     * autonomous branch invokes the existing Agent runtime rather than building a
     * second one. What must stay true is that the reach is SINGULAR — one module,
     * one edge, behind a gate that is unset in production. Anything else is a
     * violation, and the assertion below still fails on it.
     */
    const AUTHORIZED = new Set(['lib/ai/integration/investigationAdmission.ts → @/lib/agent/run'])
    const typeOnly = (v: string) => v.endsWith('→ @/lib/agent/types')
    const real = violations.filter((v) => !typeOnly(v) && !AUTHORIZED.has(v))
    expect([...AUTHORIZED].every((a) => violations.includes(a))).toBe(true)
    expect(real, `unauthorized provider reach:\n${real.join('\n')}`).toEqual([])
    expect(seen.size).toBeGreaterThanOrEqual(SEEDS.length)
  })

  it('no GPT budget or spend surface was touched by Phase 2', () => {
    for (const rel of SUBSTRATE) {
      const src = read(rel)
      expect(src, rel).not.toContain('admitAiRun')
      expect(src, rel).not.toContain('getDailySpend')
      expect(src, rel).not.toContain('AI_DAILY_USD_CAP')
    }
  })
})
