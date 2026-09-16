import knex from 'knex'
import dotenv from 'dotenv'

/**
 * `.env.local` by default, exactly as before. APP_ENV_FILE lets a throwaway
 * local instance (the card-trial demo walkthrough) point at its own env file and
 * its own database without editing the shared one another dev server is using.
 * Test runs keep their fixed file.
 */
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : process.env.APP_ENV_FILE || '.env.local'
dotenv.config({ path: envFile, override: true })

/**
 * Which database a Vercel STAGING deployment talks to.
 *
 * `DATABASE_URL` is injected by the Neon marketplace integration, and that
 * injection outranks a branch-scoped project variable — so a staging preview
 * cannot be pointed at its own database by configuration alone. It silently
 * kept reading production instead, which is exactly the failure this whole
 * environment exists to avoid.
 *
 * `STAGING_DATABASE_URL` is therefore honoured, but only where it can mean
 * nothing else: a Vercel deployment that is not the production one and that
 * declares `APP_ENV=staging`. Production (APP_ENV=production, and
 * VERCEL_ENV=production) never reaches this branch, and neither does a local or
 * test run, which keep reading DATABASE_URL exactly as before.
 *
 * Staging then fails closed rather than falling back: a deployment that says it
 * is staging but has no isolated database of its own must not quietly borrow
 * production's.
 */
export function resolveDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const shared = env.DATABASE_URL ?? ''
  const isVercelStaging = Boolean(env.VERCEL) && env.APP_ENV === 'staging' && env.VERCEL_ENV !== 'production'
  if (!isVercelStaging) return shared

  const staging = env.STAGING_DATABASE_URL?.trim()
  if (!staging) {
    throw new Error('[db] APP_ENV=staging needs STAGING_DATABASE_URL; refusing to fall back to the shared DATABASE_URL')
  }
  if (staging === shared) {
    throw new Error('[db] STAGING_DATABASE_URL is the shared DATABASE_URL; that is not an isolated database')
  }
  return staging
}

const rawUrl = resolveDatabaseUrl()
if ((process.env.APP_ENV === 'test' || process.env.NODE_ENV === 'test') && !rawUrl) {
  throw new Error('Test environment requires DATABASE_URL')
}

const sslMode = new URL(rawUrl).searchParams.get('sslmode') ?? 'disable'
const useSSL = ['require', 'verify-ca', 'verify-full'].includes(sslMode)

function getConnectionString() {
  const url = new URL(rawUrl)
  url.searchParams.delete('sslmode')
  return url.toString()
}

export const db = knex({
  client: 'pg',
  connection: {
    connectionString: getConnectionString(),
    ssl: useSSL ? { rejectUnauthorized: false } : false,
  },
  pool: {
    min: 0,
    max: 10,
  },
})
