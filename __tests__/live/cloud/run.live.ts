import { afterAll, beforeAll, describe, expect, vi } from 'vitest'

/**
 * A quote's PDF through the real code: claim, real renderer client, real R2
 * client, persistence, retrieval, authenticated download, retry and recovery.
 * The same checks run in both modes; only the far end differs (see ./env.ts).
 *
 * The one spec file on purpose: the render limit must count the whole run.
 *
 * THE SECURITY BOUNDARY AGAINST PRODUCTION IS THE BUCKET-SCOPED R2 TOKEN. Every
 * check here is a backstop: the harness can see a bucket's name, not whose it is.
 */
vi.mock('next/headers', async () => {
  const { session } = await import('./session')
  return { cookies: async () => ({ get: () => (session.cookie ? { value: session.cookie } : undefined), delete: () => undefined }), headers: async () => new Headers() }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (f: unknown) => f, cacheTag: vi.fn() }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: async () => ({ status: 'PAID', hasAccess: true }) }))

import { accessCases } from './access.cases'
import { documentCases } from './documents.cases'
import { failureCases } from './failures.cases'
import { artifacts, assertBucketEmpty, createFixtures, ctx, installObjectWall, removeFixtures, removeSyntheticObjects, writeDryLog } from './harness'
import { installDryBucket, seedDryBucket } from './helpers'

beforeAll(async () => {
  if (ctx.mode === 'dry') {
    installDryBucket()
    seedDryBucket('before')
  }
  installObjectWall()
  // A test bucket with anything in it may not be the bucket it claims to be. No test runs past this.
  await assertBucketEmpty('before the run')
  if (ctx.mode === 'dry') seedDryBucket('after-check')
  await createFixtures()
  const r = ctx.r2Limits
  process.stderr.write(`[cloud] ${ctx.mode}: at most ${ctx.limits.maxRenders} Browser Run requests (${ctx.limits.maxRetries} retries), R2 uploads ${r.uploads}, deletes ${r.deletes}, reads ${r.reads}, lists ${r.lists}, objects ${r.objects}\n`)
}, 120_000)

afterAll(async () => {
  try {
    artifacts.writeIndex()
    await removeSyntheticObjects()
    await assertBucketEmpty('after the run')
  } finally {
    await writeDryLog()
    await removeFixtures()
    ctx.guard.uninstall()
  }
  expect(ctx.guard.refusals).toEqual([])
  expect(ctx.limiter.stopped).toBe(false)
  expect(ctx.r2.refused).toEqual({ upload: 0, delete: 0, read: 0, list: 0 })
}, 120_000)

describe(`quote PDF, cloud path (${ctx.mode})`, () => {
  documentCases()
  accessCases()
  failureCases()
})
