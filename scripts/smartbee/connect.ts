/**
 * Operator script: connect ONE agency to SmartBee (there is no settings screen).
 *
 *   SMARTBEE_CONNECT_EMAIL=<owner email> \
 *   SMARTBEE_PROVIDER_USER_TOKEN=<token from SmartBee> \
 *   SMARTBEE_TEST_CLIENT_ID=… SMARTBEE_TEST_CLIENT_PASSWORD=… \
 *   npx tsx scripts/smartbee/connect.ts --env test --business-type authorized [--apply]
 *
 *   SMARTBEE_CONNECT_EMAIL=<owner email> npx tsx scripts/smartbee/connect.ts --disconnect [--apply]
 *
 * WHAT IT DOES, in order, and stops at the first failure:
 *   1. finds the user by email (case-insensitive). Exactly ONE active user, with
 *      role ADMIN or MNGR (the Action Runtime's ceiling for approval-required
 *      actions), or it refuses. Never guesses an agency;
 *   2. checks the business token against SmartBee with a one-row document
 *      search (nothing is created). 120 = verified; 94 naming documents/search
 *      = token recognized but the account has no search permission (accepted,
 *      reported as such: issuance never uses search); 98 or anything else refuses;
 *   3. only with --apply: stores the token ENCRYPTED (SECRETS_ENC_KEY) in
 *      smartbee_connections, with that user as the owner.
 * Then prints the agency id to put in SMARTBEE_AGENCY_IDS. Without --apply
 * nothing is written.
 *
 * SECRETS come from environment variables only, never from arguments (shell
 * history), and are never printed. `--env production` is refused unless
 * SMARTBEE_PRODUCTION_ENABLED=1.
 *
 * Which database: config/db.ts (.env.local, or APP_ENV_FILE; .env.test under
 * NODE_ENV=test). Its host/name is printed first; check it. --apply refuses when
 * the target cannot be identified.
 */
import { db } from '../../config/db'
import { encryptSecret } from '../../lib/crypto/secrets'
import { checkSmartbeeConnection, connectionVerdict } from '../../lib/integrations/providers/smartbee/documents'
import { smartbeeProductionEnabled } from '../../lib/flags/smartbeeFlags'

type Env = 'test' | 'production'
const BUSINESS_TYPES = ['exempt', 'authorized', 'company'] as const
type BusinessType = (typeof BUSINESS_TYPES)[number]

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const value = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const fail = (msg: string): never => {
  console.error(`REFUSED: ${msg}`)
  process.exit(1)
}

/** host/database of the target, from config/db.ts (`connection.connectionString`). Never the credentials. */
function dbTarget(): string | null {
  const conn = (db.client.config as { connection?: unknown }).connection
  const raw = typeof conn === 'string' ? conn : (conn as { connectionString?: string } | undefined)?.connectionString
  if (!raw) return null
  try {
    const u = new URL(raw)
    return `${u.host}${u.pathname}`
  } catch {
    return null
  }
}

type Owner = { id: number; agencyId: number; role: string; agencyName: string }

async function resolveOwner(email: string): Promise<Owner> {
  const rows = (await db('users as u')
    .join('agencies as a', 'a.id', 'u.agencyId')
    .whereRaw('lower(u.email) = lower(?)', [email.trim()])
    .select('u.id', 'u.agencyId', 'u.role', 'u.suspended', 'a.name as agencyName')) as (Owner & { suspended: boolean | null })[]
  if (rows.length !== 1) return fail(`expected exactly one user for that email, found ${rows.length}`)
  const u = rows[0]
  if (u.suspended) return fail('that user is suspended')
  if (u.role !== 'ADMIN' && u.role !== 'MNGR') return fail(`owner role is ${u.role}; approval-required actions need ADMIN or MNGR`)
  return { id: Number(u.id), agencyId: Number(u.agencyId), role: u.role, agencyName: u.agencyName }
}

async function connect(apply: boolean): Promise<void> {
  const env = (value('env') ?? 'test') as Env
  if (env !== 'test' && env !== 'production') fail('--env must be test or production')
  if (env === 'production' && !smartbeeProductionEnabled()) fail('production is disabled (SMARTBEE_PRODUCTION_ENABLED is not 1)')
  const businessType = value('business-type') as BusinessType | undefined
  if (!businessType || !BUSINESS_TYPES.includes(businessType)) fail('--business-type must be exempt, authorized or company (as registered in SmartBee)')
  const email = process.env.SMARTBEE_CONNECT_EMAIL ?? fail('SMARTBEE_CONNECT_EMAIL is not set')
  const token = process.env.SMARTBEE_PROVIDER_USER_TOKEN?.trim() ?? fail('SMARTBEE_PROVIDER_USER_TOKEN is not set')
  if (!token) fail('SMARTBEE_PROVIDER_USER_TOKEN is empty')

  const target = dbTarget()
  console.log(`database: ${target ?? 'UNKNOWN'}`)
  // Nothing is ever written to a database this script cannot name.
  if (apply && !target) fail('cannot identify the target database; nothing written')
  const owner = await resolveOwner(email)
  console.log(`owner: user ${owner.id} (${owner.role}), agency ${owner.agencyId} "${owner.agencyName}"`)

  const verdict = connectionVerdict(env, await checkSmartbeeConnection(env, token))
  if (!verdict.ok) fail(verdict.message)
  console.log(verdict.message)

  if (!apply) {
    console.log('DRY RUN: nothing written. Re-run with --apply to store the connection.')
    return
  }
  await db('smartbee_connections')
    .insert({
      agencyId: owner.agencyId,
      ownerUserId: owner.id,
      environment: env,
      businessType,
      providerUserTokenEnc: encryptSecret(token),
      status: 'active',
      lastVerifiedAt: new Date(),
      lastError: null,
      updatedAt: db.fn.now(),
    })
    .onConflict('agencyId')
    .merge()
  console.log(`STORED: smartbee_connections for agency ${owner.agencyId} (${env}, ${businessType}).`)
  console.log(`Next: set SMARTBEE_AGENCY_IDS=${owner.agencyId} for this environment (separately approved).`)
}

async function disconnect(apply: boolean): Promise<void> {
  const email = process.env.SMARTBEE_CONNECT_EMAIL ?? fail('SMARTBEE_CONNECT_EMAIL is not set')
  const target = dbTarget()
  console.log(`database: ${target ?? 'UNKNOWN'}`)
  if (apply && !target) fail('cannot identify the target database; nothing written')
  const owner = await resolveOwner(email)
  const row = await db('smartbee_connections').where({ agencyId: owner.agencyId }).first('id', 'status')
  if (!row) fail(`agency ${owner.agencyId} has no SmartBee connection`)
  if (!apply) {
    console.log(`DRY RUN: would mark agency ${owner.agencyId}'s connection (now ${row.status}) as disconnected.`)
    return
  }
  await db('smartbee_connections').where({ agencyId: owner.agencyId }).update({ status: 'disconnected', updatedAt: db.fn.now() })
  console.log(`DISCONNECTED agency ${owner.agencyId}. Native issuance stays blocked while the row exists or the agency is on SMARTBEE_AGENCY_IDS.`)
}

;(flag('disconnect') ? disconnect(flag('apply')) : connect(flag('apply')))
  .catch((err) => {
    console.error('FAILED:', (err as Error)?.name ?? 'Error', (err as Error)?.message?.slice(0, 200) ?? '')
    process.exitCode = 1
  })
  .finally(() => db.destroy())
