import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Each case runs the whole cloud harness as a child, in dry mode, and reads what it did. */

type PerKind = { upload: number; delete: number; read: number; list: number }
type Log = { puts: string[]; deletes: string[]; remaining: string[]; limiter: { requests: number; retries: number; refused: number; stopped: boolean }; limits: { maxRenders: number; maxRetries: number }; wallRefusals: string[]; r2: { attempts: PerKind; completed: PerKind; refused: PerKind; objectsCreated: number }; r2Limits: Record<string, number> }
type Run = { exit: number; output: string; log: Log | null; tests: { status: string; title: string }[]; report: string; artifacts: string }

const OUTSIDE = 'tenants/5/quotes/1/customer.pdf'
const NEAR_MISS = 'tenants/998010/quotes/1/near-miss.pdf'
const SYNTHETIC = 'tenants/99801/quotes/7/leftover.pdf'

function child(env: Record<string, string>, args: string[] = []): Promise<Run> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quote-cloud-guard-'))
  const logFile = path.join(dir, 'ops.json')
  const reportFile = path.join(dir, 'report.json')
  const artifacts = path.join(dir, 'artifacts')
  const { QUOTE_CLOUD_MODE: _mode, ...inherited } = process.env
  return new Promise((resolve) => {
    execFile(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.quote-cloud.config.ts', '--reporter=json', `--outputFile=${reportFile}`, ...args], { env: { ...inherited, NODE_ENV: 'test', QUOTE_CLOUD_DRY_LOG: logFile, QUOTE_CLOUD_ARTIFACT_DIR: artifacts, ...env }, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const report = existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : ''
      const parsed = report ? (JSON.parse(report) as { testResults: { assertionResults: { status: string; title: string }[] }[] }) : null
      resolve({ exit: err ? Number(err.code ?? 1) : 0, output: `${stdout}${stderr}`, log: existsSync(logFile) ? (JSON.parse(readFileSync(logFile, 'utf8')) as Log) : null, tests: parsed?.testResults.flatMap((r) => r.assertionResults) ?? [], report, artifacts })
    })
  })
}
const noneRan = (r: Run) => r.tests.length > 0 && r.tests.every((t) => t.status !== 'passed' && t.status !== 'failed')

describe('the empty-bucket guard', () => {
  it('an unexpected object: no test runs, nothing uploads, and only the synthetic prefix is cleaned', async () => {
    const r = await child({ QUOTE_CLOUD_DRY_SEED: 'unexpected' })
    expect(r.exit).not.toBe(0)
    expect(r.tests.length).toBe(19)
    expect(noneRan(r), JSON.stringify(r.tests.slice(0, 3))).toBe(true)
    expect(r.log).not.toBeNull()
    expect(r.log!.puts).toEqual([])
    expect(r.log!.limiter.requests).toBe(0)
    expect(r.log!.deletes).toEqual([SYNTHETIC])
    expect(r.log!.remaining.sort()).toEqual([NEAR_MISS, OUTSIDE].sort())
    expect(r.report).toContain('the bucket must be empty')
    expect(r.report).not.toContain('customer.pdf')
  })

  it('only leftovers of an earlier run: still no test runs, and the leftovers are removed', async () => {
    const r = await child({ QUOTE_CLOUD_DRY_SEED: 'synthetic' })
    expect(r.exit).not.toBe(0)
    expect(noneRan(r)).toBe(true)
    expect(r.log!.puts).toEqual([])
    expect(r.log!.limiter.requests).toBe(0)
    expect(r.log!.deletes).toEqual([SYNTHETIC])
    expect(r.log!.remaining).toEqual([])
  })

  it('an object that appears during the run: the final check fails and the object is left alone', async () => {
    const r = await child({ QUOTE_CLOUD_DRY_SEED: 'late' }, ['-t', 'no session opens'])
    expect(r.exit).not.toBe(0)
    expect(r.tests.filter((t) => t.status === 'passed').map((t) => t.title)).toEqual(['no session opens nothing'])
    expect(r.log!.deletes).toEqual([])
    expect(r.log!.remaining).toEqual([OUTSIDE])
    expect(r.report).toContain('after the run')
  })
})

describe('the render limits', () => {
  it('stops at the limit: nothing further is requested or stored', async () => {
    const r = await child({ QUOTE_CLOUD_MAX_RENDERS: '2', QUOTE_CLOUD_MAX_RETRIES: '0' }, ['-t', 'lines: rendered'])
    expect(r.exit).not.toBe(0)
    expect(r.log!.limiter).toMatchObject({ requests: 2, retries: 0, stopped: true })
    expect(r.log!.limiter.refused).toBeGreaterThanOrEqual(1)
    expect(r.log!.puts).toHaveLength(2)
  })

  it.each([
    ['not a number', { QUOTE_CLOUD_MAX_RENDERS: 'abc' }],
    ['empty', { QUOTE_CLOUD_MAX_RENDERS: '' }],
    ['over the ceiling', { QUOTE_CLOUD_MAX_RENDERS: '21' }],
    ['retries over the ceiling', { QUOTE_CLOUD_MAX_RETRIES: '4' }],
  ])('a limit that is %s: refused before anything runs', async (_what, env) => {
    const r = await child(env)
    expect(r.exit).not.toBe(0)
    expect(r.log).toBeNull()
    expect(r.tests.filter((t) => t.status === 'passed')).toEqual([])
    expect(r.report + r.output).toContain('QUOTE_CLOUD_MAX_RE')
  })
})

describe('the R2 operation limits', () => {
  const RENDERS = ['-t', 'lines: rendered']

  it('uploads: the attempt over the limit never reaches the bucket', async () => {
    const r = await child({ QUOTE_CLOUD_MAX_R2_UPLOADS: '1' }, RENDERS)
    expect(r.exit).not.toBe(0)
    expect(r.log!.r2.attempts.upload).toBe(1)
    expect(r.log!.r2.refused.upload).toBeGreaterThanOrEqual(1)
    expect(r.log!.puts).toHaveLength(1)
  })

  it('deletes: cleanup stops at the limit, and the final check reports what is left', async () => {
    const r = await child({ QUOTE_CLOUD_MAX_R2_DELETES: '1' }, RENDERS)
    expect(r.exit).not.toBe(0)
    expect(r.log!.deletes).toHaveLength(1)
    expect(r.log!.r2.completed.delete).toBe(1)
    expect(r.log!.r2.refused.delete).toBeGreaterThanOrEqual(1)
    expect(r.log!.remaining.length).toBeGreaterThan(0)
  })

  it('reads: the read over the limit is refused', async () => {
    const r = await child({ QUOTE_CLOUD_MAX_R2_READS: '1' }, RENDERS)
    expect(r.exit).not.toBe(0)
    expect(r.log!.r2.attempts.read).toBe(1)
    expect(r.log!.r2.refused.read).toBeGreaterThanOrEqual(1)
  })

  it('listings: over the limit is refused', async () => {
    const r = await child({ QUOTE_CLOUD_MAX_R2_LISTS: '1' }, ['-t', 'no session opens'])
    expect(r.exit).not.toBe(0)
    expect(r.log!.r2.attempts.list).toBe(1)
    expect(r.log!.r2.refused.list).toBeGreaterThanOrEqual(1)
  })

  it('objects: a second new object is refused even with uploads to spare', async () => {
    const r = await child({ QUOTE_CLOUD_MAX_R2_OBJECTS: '1' }, RENDERS)
    expect(r.exit).not.toBe(0)
    expect(r.log!.r2.objectsCreated).toBe(1)
    expect(r.log!.puts).toHaveLength(1)
    expect(r.log!.r2.refused.upload).toBeGreaterThanOrEqual(1)
  })

  it.each(['QUOTE_CLOUD_MAX_R2_UPLOADS', 'QUOTE_CLOUD_MAX_R2_DELETES', 'QUOTE_CLOUD_MAX_R2_READS', 'QUOTE_CLOUD_MAX_R2_LISTS', 'QUOTE_CLOUD_MAX_R2_OBJECTS'])('%s invalid or over its ceiling: refused before any operation', async (name) => {
    for (const bad of ['abc', '0', '999']) {
      const r = await child({ [name]: bad }, ['-t', 'no session opens'])
      expect(r.exit).not.toBe(0)
      expect(r.log, `${name}=${bad}`).toBeNull()
      expect(r.report + r.output).toContain(name)
    }
  })
})

describe('a dry-only control cannot reach a real run', () => {
  it('real mode with a dry seed is refused before the credentials file is opened', async () => {
    const r = await child({ QUOTE_CLOUD_MODE: 'real', QUOTE_CLOUD_DRY_SEED: 'late' })
    expect(r.exit).not.toBe(0)
    expect(r.log).toBeNull()
    expect(r.report + r.output).toContain('dry-only')
    expect(r.report + r.output).not.toContain('.env.quote-cloud.local is required')
  })
})

describe('a complete dry run', () => {
  it('stays inside the limits, leaves the bucket empty, prints no signed link, and keeps the review files', async () => {
    const r = await child({})
    expect(r.exit, r.report.slice(0, 1500)).toBe(0)
    expect(r.tests.every((t) => t.status === 'passed')).toBe(true)
    expect(r.log!.limiter).toEqual({ requests: 17, retries: 1, refused: 0, stopped: false })
    expect(r.log!.limits).toEqual({ maxRenders: 20, maxRetries: 3 })
    expect(r.log!.r2Limits).toEqual({ uploads: 16, deletes: 16, reads: 26, lists: 8, objects: 16 })
    expect(r.log!.r2.attempts).toEqual({ upload: 14, delete: 14, read: 22, list: 5 })
    expect(r.log!.r2.completed).toEqual({ upload: 14, delete: 14, read: 21, list: 5 })
    expect(r.log!.r2.refused).toEqual({ upload: 0, delete: 0, read: 0, list: 0 })
    expect(r.log!.r2.objectsCreated).toBe(14)
    expect(r.log!.remaining).toEqual([])
    expect(r.log!.deletes.every((k) => k.startsWith('tenants/99801/') || k.startsWith('tenants/99802/'))).toBe(true)
    expect(r.log!.wallRefusals).toEqual(['DeleteObjectCommand', 'DeleteObjectCommand'])
    for (const text of [r.output, r.report]) {
      expect(text).not.toMatch(/X-Amz-Signature=|X-Amz-Credential=/)
      expect(text).not.toContain('fake-secret')
      expect(text).not.toContain('invalidquotestage2harnesstokennotreal000')
    }
    const index = JSON.parse(readFileSync(path.join(r.artifacts, 'index.json'), 'utf8')) as { scenario: string; images: string[] }[]
    expect(index.map((e) => e.scenario).sort()).toEqual(['discount-validity', 'exempt', 'free-zero', 'lines-1', 'lines-12', 'lines-50', 'long-item-names', 'mixed-hebrew-digits-latin', 'vat-inclusive'])
    expect(index.every((e) => e.images.length > 0)).toBe(true)
    expect(readFileSync(path.join(r.artifacts, 'INDEX.md'), 'utf8')).toContain('rm -rf .quote-cloud-artifacts')
  })
})
