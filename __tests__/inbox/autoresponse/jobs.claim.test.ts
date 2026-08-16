import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

describe('auto_response_jobs claim contract', () => {
  it('claims only pending jobs whose notBefore is due', () => {
    const src = read('db/autoResponseJobs.ts')
    expect(src).toContain(`status = 'pending' AND "notBefore" <= now()`)
    expect(src).toContain('FOR UPDATE SKIP LOCKED')
    expect(src).toContain('ORDER BY "notBefore" ASC')
  })

  it('keeps at most one in-flight job per conversation', () => {
    const src = read('migrations/20260624000001_create_auto_response.cjs')
    expect(src).toContain('auto_response_jobs_inflight_uniq')
    expect(src).toMatch(/ON auto_response_jobs \("conversationId"\) WHERE status IN \('pending','processing'\)/)
  })
})

describe('IRE scheduled drain', () => {
  it('registers /api/cron/send-auto-responses every minute', () => {
    const vercel = JSON.parse(read('vercel.json')) as { crons: { path: string; schedule: string }[] }
    const entry = vercel.crons.find((c) => c.path === '/api/cron/send-auto-responses')
    expect(entry, 'send-auto-responses cron is not registered in vercel.json').toBeTruthy()
    expect(entry?.schedule).toBe('*/1 * * * *')
  })

  it('the cron route drains via the existing worker claim path', () => {
    const src = read('app/api/cron/send-auto-responses/route.ts')
    expect(src).toContain('const result = await runAutoResponseWorker()')
  })
})

describe('auto-response delay source of truth', () => {
  it('settings page passes the stored delaySeconds value', () => {
    const src = read('app/(app)/settings/(admin_settings)/auto-response/page.tsx')
    expect(src).toContain('delaySeconds={channel?.delaySeconds ?? 0}')
    expect(src).not.toMatch(/delaySeconds=\{0\}/)
  })

  it('settings read selects delaySeconds explicitly, matching ingest', () => {
    const settings = read('db/autoResponseSettings.ts')
    const ingest = read('lib/inbox/ingestWhatsappInbound.ts')
    expect(settings).toMatch(/\.first\([\s\S]*'delaySeconds'/)
    expect(ingest).toContain(".first('mode', 'delaySeconds')")
  })
})
