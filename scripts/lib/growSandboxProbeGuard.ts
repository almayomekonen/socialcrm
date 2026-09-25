/**
 * Fail-closed gate for scripts/grow-sandbox-probe.ts.
 *
 * The probe exists to collect Gate B evidence from Grow's SANDBOX API. It must
 * never run as, or next to, anything that can touch real money or application
 * data. Preview deployments currently inherit production APP_ENV, GROW_MODE and
 * DATABASE_URL, so "it said sandbox" is not enough: this refuses unless every
 * condition below holds, and never echoes a value in its refusal.
 */

export const SANDBOX_ENV_FILE = '.env.grow-sandbox.local'
export const SANDBOX_STATE_DIR = 'docs/superpowers/analysis/grow-sandbox'

const ALLOWED_KEYS = ['GROW_MODE', 'GROW_USER_ID', 'GROW_PAGE_CODE_TOKEN'] as const
const GROW_KEYS_IN_SHELL = ['GROW_MODE', 'GROW_USER_ID', 'GROW_PAGE_CODE_TOKEN', 'GROW_API_KEY']

export type ProbeGuardInput = {
  envFileExists: boolean
  envFileIgnoredByGit: boolean
  stateDirIgnoredByGit: boolean
  envFileVars: Record<string, string>
  processEnv: Record<string, string | undefined>
}

export type ProbeIdentity = { userId: string; tokenPageCode: string }

export class SandboxProbeRefusal extends Error {
  constructor(
    public reason: string,
    detail = '',
  ) {
    super(`grow-sandbox-probe refused: ${reason}${detail ? ` (${detail})` : ''}`)
    this.name = 'SandboxProbeRefusal'
  }
}

const present = (v: string | undefined) => typeof v === 'string' && v.trim() !== ''

export function assertSandboxProbeEnvironment(input: ProbeGuardInput): ProbeIdentity {
  if (!input.envFileExists) throw new SandboxProbeRefusal('sandbox_env_file_missing', SANDBOX_ENV_FILE)
  if (!input.envFileIgnoredByGit) throw new SandboxProbeRefusal('sandbox_env_file_not_gitignored', SANDBOX_ENV_FILE)
  if (!input.stateDirIgnoredByGit) throw new SandboxProbeRefusal('state_dir_not_gitignored', SANDBOX_STATE_DIR)

  const env = input.processEnv
  const deployed =
    present(env.VERCEL) ||
    present(env.VERCEL_ENV) ||
    present(env.NEXT_PUBLIC_VERCEL_ENV) ||
    env.APP_ENV === 'production' ||
    env.NODE_ENV === 'production'
  if (deployed) throw new SandboxProbeRefusal('refuses_deployed_or_production_runtime')

  const shellGrow = GROW_KEYS_IN_SHELL.filter((k) => present(env[k]))
  if (shellGrow.length) throw new SandboxProbeRefusal('grow_variables_already_in_environment', shellGrow.join(','))

  const vars = input.envFileVars
  const unexpected = Object.keys(vars).filter((k) => !(ALLOWED_KEYS as readonly string[]).includes(k))
  if (vars.GROW_MODE !== 'sandbox') throw new SandboxProbeRefusal('sandbox_env_file_mode_not_sandbox')
  if (unexpected.length) throw new SandboxProbeRefusal('sandbox_env_file_unexpected_keys', unexpected.join(','))

  const userId = vars.GROW_USER_ID?.trim() ?? ''
  const tokenPageCode = vars.GROW_PAGE_CODE_TOKEN?.trim() ?? ''
  if (!userId || !tokenPageCode) throw new SandboxProbeRefusal('sandbox_identifiers_missing')

  return { userId, tokenPageCode }
}
