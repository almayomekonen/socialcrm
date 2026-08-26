/**
 * Phase 3 — the tick gate and the one-path guarantee. Unit tests, no DB, no model.
 *
 * The end-to-end chain is proven against real PostgreSQL in
 * __tests__/runtime/signalTick.test.ts. What is proven HERE is what a database
 * cannot answer: that a disabled integration performs no I/O at all, and that
 * there is exactly ONE production execution path — no module outside the tick
 * reaches the runtime, and nothing in the Phase 3 surface can touch a provider,
 * the notification lifecycle, or CRM business state.
 *
 * Runs under `test:unit` (VITEST_NO_DB=1).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runSignalTick } from '@/lib/ai/integration/signalTick'
import { businessDayBounds } from '@/lib/today/time'
import type { SignalSweepDeps } from '@/lib/ai/integration/signalSweep'
import type { SignalWorkerDeps } from '@/lib/ai/integration/signalWorker'
import type { LeadFact } from '@/lib/today/types'
import type { Scope } from '@/db/ai/stateManagement'
import type { ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
/** Code with comments removed — these modules document what they must never do. */
const codeOf = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

const NOW = new Date('2026-08-25T09:00:00.000Z')
const ctx = businessDayBounds(NOW.getTime())
const DAY = 86_400_000

/** Every module that can run in the scheduled path. */
const PHASE3_SURFACE = [
  'app/api/cron/signal-sweep/route.ts',
  'lib/ai/integration/signalTick.ts',
  'lib/ai/integration/signalSweep.ts',
  'lib/ai/integration/signalWorker.ts',
  'lib/ai/integration/observationKey.ts',
  'lib/ai/integration/detectors/registry.ts',
  'lib/ai/integration/detectors/followupOverdue.ts',
  'db/ai/signalJobs.ts',
  'db/ai/leadFacts.ts',
]

function overdueFact(): LeadFact {
  return {
    id: 77,
    name: null,
    phone: null,
    status: 'contacted',
    leadSource: 'manual',
    createdAt: ctx.nowMs - 30 * DAY,
    nextFollowUpAt: ctx.dayStart - 2 * DAY,
    lastActivityAt: ctx.nowMs - 5 * DAY,
    lastInboundAt: null,
    lastHumanOutboundAt: null,
    hasOpenTask: false,
    earliestOpenTaskDueAt: null,
  }
}

type Probe = {
  factsCalls: Scope[]
  enqueued: ExternalSignal[]
  claims: number
  reclaims: number
  sweep: SignalSweepDeps
  worker: SignalWorkerDeps
}

function probe(): Probe {
  const p: Partial<Probe> = { factsCalls: [], enqueued: [], claims: 0, reclaims: 0 }
  p.sweep = {
    listAgencyLeadFacts: (async (scope: Scope) => {
      p.factsCalls!.push(scope)
      return [overdueFact()]
    }) as SignalSweepDeps['listAgencyLeadFacts'],
    enqueueSignal: (async (signal: ExternalSignal) => {
      p.enqueued!.push(signal)
      return { enqueued: true, jobId: p.enqueued!.length, observationKey: 'k' }
    }) as SignalSweepDeps['enqueueSignal'],
  }
  p.worker = {
    reclaim: (async () => {
      p.reclaims! += 1
      return 0
    }) as SignalWorkerDeps['reclaim'],
    claim: (async () => {
      p.claims! += 1
      return []
    }) as SignalWorkerDeps['claim'],
  }
  return p as Probe
}

const KEYS = ['SIGNAL_SWEEP_AGENCY_IDS', 'SIGNAL_SWEEP_KILL', 'SIGNAL_WORKER_KILL'] as const
const saved: Record<string, string | undefined> = {}
for (const k of KEYS) saved[k] = process.env[k]
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

// ── B / C / D. the gate ──────────────────────────────────────────────────────

describe('C · a disabled integration performs no work', () => {
  it('an unset allowlist skips the tick entirely — no CRM read, no claim', async () => {
    delete process.env.SIGNAL_SWEEP_AGENCY_IDS
    delete process.env.SIGNAL_SWEEP_KILL
    delete process.env.SIGNAL_WORKER_KILL
    const p = probe()
    const s = await runSignalTick({ now: NOW, sweep: { deps: p.sweep }, worker: { deps: p.worker } })

    expect(s.skipped).toBe(true)
    expect(s.agencies).toBe(0)
    expect(p.factsCalls).toEqual([])
    expect(p.enqueued).toEqual([])
    expect(p.claims).toBe(0)
    expect(p.reclaims).toBe(0) // not even a reclaim sweep
  })

  it("refuses 'all' rather than sweeping every tenant", async () => {
    process.env.SIGNAL_SWEEP_AGENCY_IDS = 'all'
    const p = probe()
    const s = await runSignalTick({ now: NOW, sweep: { deps: p.sweep }, worker: { deps: p.worker } })
    expect(s.skipped).toBe(true)
    expect(p.factsCalls).toEqual([])
    expect(p.claims).toBe(0)
  })
})

describe('B · the kill switches', () => {
  it.each(['1', 'true'])('SIGNAL_SWEEP_KILL=%s stops the whole tick', async (kill) => {
    process.env.SIGNAL_SWEEP_AGENCY_IDS = '103'
    process.env.SIGNAL_SWEEP_KILL = kill
    const p = probe()
    const s = await runSignalTick({ now: NOW, sweep: { deps: p.sweep }, worker: { deps: p.worker } })
    expect(s.skipped).toBe(true)
    expect(p.factsCalls).toEqual([])
    expect(p.claims).toBe(0)
  })

  it.each(['1', 'true'])('SIGNAL_WORKER_KILL=%s stops the whole tick, producer included', async (kill) => {
    process.env.SIGNAL_SWEEP_AGENCY_IDS = '103'
    delete process.env.SIGNAL_SWEEP_KILL
    process.env.SIGNAL_WORKER_KILL = kill
    const p = probe()
    const s = await runSignalTick({ now: NOW, sweep: { deps: p.sweep }, worker: { deps: p.worker } })
    expect(s.skipped).toBe(true)
    expect(p.factsCalls).toEqual([])
    expect(p.claims).toBe(0)
  })

  it.each(['SIGNAL_SWEEP_KILL', 'SIGNAL_WORKER_KILL'])(
    '%s beats an explicit agency override — no caller can step around it',
    async (key) => {
      delete process.env.SIGNAL_SWEEP_KILL
      delete process.env.SIGNAL_WORKER_KILL
      process.env[key] = '1'
      const p = probe()
      const s = await runSignalTick({ now: NOW, agencyIds: [103], sweep: { deps: p.sweep }, worker: { deps: p.worker } })
      expect(s.skipped).toBe(true)
      expect(p.factsCalls).toEqual([])
      expect(p.claims).toBe(0)
    },
  )

  it('an override still bypasses the ALLOWLIST when nothing is killed', async () => {
    delete process.env.SIGNAL_SWEEP_AGENCY_IDS
    delete process.env.SIGNAL_SWEEP_KILL
    delete process.env.SIGNAL_WORKER_KILL
    const p = probe()
    const s = await runSignalTick({ now: NOW, agencyIds: [103], sweep: { deps: p.sweep }, worker: { deps: p.worker } })
    expect(s.skipped).toBe(false)
    expect(p.factsCalls).toEqual([{ agencyId: 103 }])
  })
})

describe('D · an enabled agency runs the detector and then the drain, in order', () => {
  it('sweeps the allowlisted agency and drains once', async () => {
    process.env.SIGNAL_SWEEP_AGENCY_IDS = '103'
    delete process.env.SIGNAL_SWEEP_KILL
    delete process.env.SIGNAL_WORKER_KILL
    const p = probe()
    const s = await runSignalTick({ now: NOW, sweep: { deps: p.sweep }, worker: { deps: p.worker } })

    expect(s.skipped).toBe(false)
    expect(s.agencies).toBe(1)
    expect(p.factsCalls).toEqual([{ agencyId: 103 }])
    expect(p.enqueued).toHaveLength(1)
    expect(p.enqueued[0].absence?.violatedExpectation).toBe('followup.overdue')
    expect(p.reclaims).toBe(1)
    expect(p.claims).toBe(1)
    expect(s.sweep.enqueued).toBe(1)
  })

  it('sweeps only allowlisted agencies, never one merely present in the CRM', async () => {
    process.env.SIGNAL_SWEEP_AGENCY_IDS = '103,104'
    const p = probe()
    await runSignalTick({ now: NOW, sweep: { deps: p.sweep }, worker: { deps: p.worker } })
    expect(p.factsCalls.map((c) => c.agencyId)).toEqual([103, 104])
  })
})

// ── the one-path guarantee ───────────────────────────────────────────────────

describe('exactly one production execution path', () => {
  it('the tick is the only module that runs producer and drain together', () => {
    const runners = PHASE3_SURFACE.filter((rel) => {
      const code = codeOf(rel)
      return code.includes('runSignalSweep') && code.includes('runSignalWorker')
    })
    expect(runners).toEqual(['lib/ai/integration/signalTick.ts'])
  })

  it('only the worker reaches the ratified runtime', () => {
    const reachers = PHASE3_SURFACE.filter((rel) => codeOf(rel).includes('RuntimeScheduler'))
    expect(reachers).toEqual(['lib/ai/integration/signalWorker.ts'])
  })

  it('only the worker writes the coverage sink', () => {
    const writers = PHASE3_SURFACE.filter((rel) => codeOf(rel).includes('recordCoverageDecision'))
    expect(writers).toEqual(['lib/ai/integration/signalWorker.ts'])
  })

  it('the producer no longer processes — the inline Phase 1 path is gone', () => {
    const code = codeOf('lib/ai/integration/signalSweep.ts')
    for (const forbidden of [
      'RuntimeScheduler',
      'interpret(',
      '.admit(',
      'recordCoverageDecision',
      'runtime/reasoning',
      'runtime/toolAction',
    ]) {
      expect(code, `the inline path survives in signalSweep: ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('exactly one cron route invokes the tick', () => {
    const routes = readdirSync(join(ROOT, 'app/api/cron'))
      .filter((d) => existsSync(join(ROOT, 'app/api/cron', d, 'route.ts')))
      .filter((d) => codeOf(`app/api/cron/${d}/route.ts`).includes('runSignalTick'))
    expect(routes).toEqual(['signal-sweep'])
  })

  it('no other route or script reaches the signal producer or worker', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.next') continue
          walk(rel)
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          // Declarations are not call sites: a module that DEFINES runSignalSweep
          // is not a module that RUNS it. Strip the declarations, then look for
          // anything that still reaches one of the three entry points.
          const code = codeOf(rel).replace(/export\s+(?:async\s+)?function\s+runSignal\w+/g, ' ')
          if (/runSignalSweep\s*\(|runSignalWorker\s*\(|runSignalTick\s*\(/.test(code)) hits.push(rel)
        }
      }
    }
    for (const dir of ['app', 'actions', 'scripts', 'lib']) if (existsSync(join(ROOT, dir))) walk(dir)

    expect(hits.sort()).toEqual(['app/api/cron/signal-sweep/route.ts', 'lib/ai/integration/signalTick.ts'])
  })
})

// ── N / O / P. boundaries ────────────────────────────────────────────────────

describe('O · no notification writes anywhere in Phase 3', () => {
  it('nothing in the scheduled path imports or names the notification engine', () => {
    for (const rel of PHASE3_SURFACE) {
      const code = codeOf(rel)
      expect(code, rel).not.toMatch(/from '@\/(lib|db)\/notifications/)
      expect(code, rel).not.toContain('notifyEvent')
      expect(code, rel).not.toContain('notification_jobs')
      expect(code, rel).not.toMatch(/\bnotifications\b/)
    }
  })
})

describe('P · no CRM business-state writes anywhere in Phase 3', () => {
  it('the only write targets are signal_jobs and the isolated audit sink', () => {
    const written = new Set<string>()
    for (const rel of PHASE3_SURFACE) {
      const code = codeOf(rel)
      for (const m of code.matchAll(/(?:INSERT INTO|UPDATE)\s+([a-z_]+)/g)) written.add(m[1])
      for (const m of code.matchAll(/\.(?:insert|update|del)\(/g)) written.add(`builder-write:${m[0]}`)
    }
    // db/ai/leadFacts.ts reads `clients`, and only reads it.
    expect([...written].sort()).toEqual(['builder-write:.update(', 'signal_jobs'])
    expect(codeOf('db/ai/signalJobs.ts')).toContain('.update({')
    expect(codeOf('db/ai/leadFacts.ts')).not.toMatch(/\.(insert|update|del)\(/)
  })

  it('the CRM read is a read: no write verb touches a business table', () => {
    const code = codeOf('db/ai/leadFacts.ts')
    expect(code).not.toMatch(/INSERT INTO|UPDATE\s+clients|DELETE FROM/)
    expect(code).toContain("db('clients')")
  })
})

describe('N · no provider is reachable from the Phase 3 path', () => {
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
    return [...read(rel).matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
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
    const queue = [
      ...PHASE3_SURFACE,
      'lib/ai/runtime/eventInterpretation.ts',
      'lib/ai/runtime/scheduler.ts',
      'lib/ai/runtime/reasoning.ts',
      'lib/ai/runtime/toolAction.ts',
    ]
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

    /**
     * `@/lib/agent/trace` is INERT, and this exemption PROVES it rather than
     * asserting it. The module is a single console.log emitter with ZERO imports,
     * so it cannot reach a provider transitively or otherwise — the same reasoning
     * that already authorizes `@/lib/agent/types`, but checked instead of argued.
     *
     * The admission module reaches it so a swallowed persistence failure is
     * reported on the SAME `[AGENT-TRACE]` stream, correlated by investigationId.
     * Duplicating the emitter under `lib/ai/integration/` would satisfy the path
     * rule while splitting one observability format across two modules.
     *
     * Give trace.ts an import and this exemption evaporates — which is the point.
     */
    const traceOnly = (v: string) => v.endsWith('→ @/lib/agent/trace')
    const traceImports = (read('lib/agent/trace.ts').match(/^import\s/gm) ?? []).length
    expect(traceImports, '@/lib/agent/trace is exempt ONLY while it imports nothing').toBe(0)

    const real = violations.filter((v) => !typeOnly(v) && !traceOnly(v) && !AUTHORIZED.has(v))
    expect([...AUTHORIZED].every((a) => violations.includes(a))).toBe(true)
    expect(real, `unauthorized provider reach:\n${real.join('\n')}`).toEqual([])
    expect(seen.size).toBeGreaterThanOrEqual(PHASE3_SURFACE.length)
  })

  it('no GPT budget or spend surface is touched', () => {
    for (const rel of PHASE3_SURFACE) {
      const code = codeOf(rel)
      for (const forbidden of ['admitAiRun', 'getDailySpend', 'AI_DAILY_USD_CAP', 'generateText']) {
        expect(code, rel).not.toContain(forbidden)
      }
    }
  })
})
