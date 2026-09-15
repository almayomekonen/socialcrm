/**
 * Grow SANDBOX probe — collects Gate B evidence (spec §9). Local terminal only.
 *
 *   pnpm tsx scripts/grow-sandbox-probe.ts create
 *   pnpm tsx scripts/grow-sandbox-probe.ts info <processId>
 *   pnpm tsx scripts/grow-sandbox-probe.ts charge <processId> <uniqueId> <groupId> [sum]
 *   pnpm tsx scripts/grow-sandbox-probe.ts lookup <processId> <uniqueId>
 *
 * Identifiers come ONLY from .env.grow-sandbox.local (see growSandboxProbeGuard).
 * It touches no database and no application data. Tokens are kept in a
 * gitignored 0600 state file and never printed; every Grow response is recorded
 * sanitized in the gitignored evidence log. What the responses MEAN is decided
 * by a human reading the evidence, not by this script.
 */
import { execFileSync } from 'child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { parse } from 'dotenv'
import {
  assertSandboxProbeEnvironment,
  SANDBOX_ENV_FILE,
  SANDBOX_STATE_DIR,
  SandboxProbeRefusal,
} from './lib/growSandboxProbeGuard'
import { sanitizeGrowEvidence } from './lib/sanitizeGrowEvidence'
import { GROW_SANDBOX_BASE_URL, getGrowApiConfig } from '../lib/payments/grow/config'
import { chargeToken, createTokenOnlyProcess, getPaymentProcessInfo, lookupTokenTransactionsRaw } from '../lib/payments/grow/api'
import { validateCardHolder } from '../lib/payments/cardTrial/cardHolder'
import { TOKEN_PROCESS_DESCRIPTION, CHARGE_DESCRIPTION } from '../lib/payments/cardTrial/terms'

const STATE_FILE = join(SANDBOX_STATE_DIR, 'state.local.json')
const EVIDENCE_FILE = join(SANDBOX_STATE_DIR, 'evidence.md')
/** Browser return target for the hosted page. Never the app: /billing/success must not be exercised by a probe. */
const RETURN_BASE = 'https://example.com/grow-sandbox-probe'
/** Synthetic holder; Grow requires two names and an Israeli mobile. */
const PROBE_HOLDER = { fullName: 'בדיקה סנדבוקס', phone: '0500000000' }
const MAX_PROBE_SUM = 89

type ProcessState = { processToken: string; cardToken?: string }
type State = Record<string, ProcessState>

function gitIgnored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function prepare(): void {
  process.chdir(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim())
  const envFileExists = existsSync(SANDBOX_ENV_FILE)
  const identity = assertSandboxProbeEnvironment({
    envFileExists,
    envFileIgnoredByGit: gitIgnored(SANDBOX_ENV_FILE),
    stateDirIgnoredByGit: gitIgnored(STATE_FILE) && gitIgnored(EVIDENCE_FILE),
    envFileVars: envFileExists ? parse(readFileSync(SANDBOX_ENV_FILE)) : {},
    processEnv: process.env,
  })
  process.env.GROW_MODE = 'sandbox'
  process.env.GROW_USER_ID = identity.userId
  process.env.GROW_PAGE_CODE_TOKEN = identity.tokenPageCode
  if (getGrowApiConfig().baseUrl !== GROW_SANDBOX_BASE_URL) throw new SandboxProbeRefusal('resolved_base_url_not_sandbox')
}

/** Records Grow's raw JSON without changing what the API client receives. */
let lastRaw: unknown = null
function captureGrowResponses(): void {
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const res = await original(input, init)
    lastRaw = await res.clone().json().catch(() => '<non-json body>')
    return res
  }
}

function readState(): State {
  return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State) : {}
}

function writeState(state: State): void {
  mkdirSync(SANDBOX_STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 })
}

function record(command: string, summary: Record<string, unknown>): void {
  mkdirSync(SANDBOX_STATE_DIR, { recursive: true })
  const block = [
    `## ${new Date().toISOString()} — ${command}`,
    '',
    '```json',
    JSON.stringify({ summary, response: sanitizeGrowEvidence(lastRaw) }, null, 2),
    '```',
    '',
  ].join('\n')
  appendFileSync(EVIDENCE_FILE, block)
  console.log(JSON.stringify(summary, null, 2))
  console.log(`evidence appended to ${EVIDENCE_FILE}`)
}

function positiveInt(raw: string | undefined, name: string): number {
  const n = Number(raw)
  if (!raw || !Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`)
  return n
}

function processState(state: State, processId: string | undefined): ProcessState {
  const entry = processId ? state[processId] : undefined
  if (!entry) throw new Error('unknown processId: run `create` first')
  return entry
}

function holder() {
  const v = validateCardHolder(PROBE_HOLDER)
  if (!v.ok) throw new Error('probe holder invalid')
  return { fullName: v.fullName, phone: v.phone, email: null }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  prepare()
  captureGrowResponses()
  const state = readState()

  if (command === 'create') {
    const reference = `probe-${Date.now()}`
    const out = await createTokenOnlyProcess({
      holder: holder(),
      reference,
      description: TOKEN_PROCESS_DESCRIPTION,
      successUrl: `${RETURN_BASE}/success`,
      cancelUrl: `${RETURN_BASE}/cancel`,
      notifyUrl: '',
    })
    writeState({ ...state, [out.processId]: { processToken: out.processToken } })
    record('create', { processId: out.processId, reference })
    console.log(`open in a browser (sandbox test card): ${out.url}`)
    return
  }

  if (command === 'info') {
    const entry = processState(state, args[0])
    const txs = await getPaymentProcessInfo({ processId: args[0], processToken: entry.processToken })
    const cardToken = txs.find((t) => t.cardToken)?.cardToken ?? undefined
    if (cardToken) writeState({ ...state, [args[0]]: { ...entry, cardToken } })
    record(`info ${args[0]}`, {
      transactions: txs.map((t) => ({
        statusCode: t.statusCode,
        sum: t.sum,
        cardExpShape: t.cardExp?.replace(/\d/g, 'N') ?? null,
        cardTokenPresent: Boolean(t.cardToken),
      })),
    })
    return
  }

  if (command === 'charge') {
    const entry = processState(state, args[0])
    if (!entry.cardToken) throw new Error('no cardToken recorded for this process: run `info` first')
    const uniqueIdentifier = positiveInt(args[1], 'uniqueId')
    const groupIdentifier = positiveInt(args[2], 'groupId')
    const sum = args[3] === undefined ? 1 : positiveInt(args[3], 'sum')
    if (sum > MAX_PROBE_SUM) throw new Error(`sum must be at most ${MAX_PROBE_SUM}`)
    const result = await chargeToken({
      cardToken: entry.cardToken,
      holder: holder(),
      sum,
      description: CHARGE_DESCRIPTION,
      uniqueIdentifier,
      groupIdentifier,
    })
    record(`charge ${args[0]} ${uniqueIdentifier} ${groupIdentifier} ${sum}`, { clientClassification: result.kind, result: sanitizeGrowEvidence(result) })
    return
  }

  if (command === 'lookup') {
    const entry = processState(state, args[0])
    if (!entry.cardToken) throw new Error('no cardToken recorded for this process: run `info` first')
    const env = await lookupTokenTransactionsRaw({ cardToken: entry.cardToken, uniqueIdentifier: positiveInt(args[1], 'uniqueId') })
    record(`lookup ${args[0]} ${args[1]}`, { envelopeStatus: env.status, errId: env.err?.id ?? null })
    return
  }

  throw new Error('usage: create | info <processId> | charge <processId> <uniqueId> <groupId> [sum] | lookup <processId> <uniqueId>')
}

main().catch((err) => {
  const failure = err instanceof Error ? `${err.name}: ${err.message}` : 'probe failed'
  // lastRaw is only set after prepare() passed, so the evidence path is known to be gitignored.
  if (lastRaw !== null) record(`FAILED ${process.argv.slice(2).join(' ')}`, { failure })
  console.error(failure)
  process.exit(1)
})
