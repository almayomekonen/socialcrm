import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

/**
 * The guard against AWS storage coming back: the application itself may not name an
 * AWS bucket, credential or hosted renderer. Only the S3 *protocol* client remains,
 * and only the storage adapter may import it.
 */

const tracked = (): string[] => execSync('git ls-files -co --exclude-standard', { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean)

const RUNTIME = /^(app|actions|components|config|db|emails|lib|modules|hooks|proxy\.ts|next\.config\.mjs|vercel\.json)/
const SOURCE = /\.(ts|tsx|mjs|cjs|js|json)$/

/** Real hits that are not AWS storage: Meta Pixel's collector host, and the config check that REFUSES AWS hosts. */
const allowed = (line: string) => line.includes('.on.aws') || line.includes("host.endsWith('amazonaws.com')")

describe('no AWS storage in the application', () => {
  const files = tracked().filter((f) => RUNTIME.test(f) && SOURCE.test(f) && existsSync(f))

  it.each([
    ['AWS hosts', /amazonaws\.com/],
    ['AWS credentials', /\bAWS_[A-Z_]+/],
    ['the old bucket variable', /\bS3_BUCKET_NAME\b/],
    ['old bucket names', /allin-storage|socialcrm-storage/],
    ['the old public-URL helper', /s3PublicUrl|config\/s3/],
  ])('nothing names %s', (_label, pattern) => {
    const hits: string[] = []
    for (const f of files) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (pattern.test(line) && !allowed(line)) hits.push(`${f}: ${line.trim().slice(0, 100)}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('only the storage adapter imports the S3 protocol client', () => {
    const importers = files.filter((f) => /@aws-sdk\//.test(readFileSync(f, 'utf8')) && f !== 'package.json')
    expect(importers).toEqual(['lib/storage/objects.ts'])
  })

  it('no AWS infrastructure definition remains', () => {
    expect(existsSync('infra/gotenberg-cloudformation.yaml')).toBe(false)
    expect(existsSync('config/s3.ts')).toBe(false)
  })

  it('the Gotenberg image is pinned to an exact version and digest', () => {
    const dockerfile = readFileSync('infra/gotenberg/Dockerfile', 'utf8')
    expect(dockerfile).toMatch(/^FROM gotenberg\/gotenberg:\d+\.\d+\.\d+@sha256:[a-f0-9]{64}/m)
  })
})
