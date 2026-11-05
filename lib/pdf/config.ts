/**
 * PDF renderer configuration. Pure, strict, and with no default provider: a
 * deployment states which renderer it uses, or rendering fails with a clear error.
 */

export class PdfConfigError extends Error {
  readonly missing: readonly string[]
  constructor(missing: readonly string[]) {
    super(`pdf.config_missing:${missing.join(',')}`)
    this.name = 'PdfConfigError'
    this.missing = missing
  }
}

export type PdfConfig =
  | { provider: 'cloudflare'; accountId: string; apiToken: string; timeoutMs: number }
  | { provider: 'gotenberg'; url: string; username: string; password: string; timeoutMs: number }

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 55_000

type Env = Record<string, string | undefined>

export function readPdfConfig(env: Env = process.env): PdfConfig {
  const value = (name: string) => env[name]?.trim() ?? ''
  const requireAll = (...names: string[]) => {
    const missing = names.filter((name) => !value(name))
    if (missing.length) throw new PdfConfigError(missing)
  }
  const parsed = Number(value('PDF_RENDER_TIMEOUT_MS'))
  // Bounded so a render always ends inside the 60-second function that started it.
  const timeoutMs = parsed > 0 ? Math.min(parsed, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS

  const provider = value('PDF_RENDERER')
  if (provider === 'cloudflare') {
    requireAll('R2_ACCOUNT_ID', 'CLOUDFLARE_BROWSER_RENDERING_API_TOKEN')
    return {
      provider,
      accountId: value('R2_ACCOUNT_ID'),
      apiToken: value('CLOUDFLARE_BROWSER_RENDERING_API_TOKEN'),
      timeoutMs,
    }
  }
  if (provider === 'gotenberg') {
    requireAll('PDF_RENDER_URL', 'GOTENBERG_API_BASIC_AUTH_USERNAME', 'GOTENBERG_API_BASIC_AUTH_PASSWORD')
    return {
      provider,
      url: value('PDF_RENDER_URL').replace(/\/+$/, ''),
      username: value('GOTENBERG_API_BASIC_AUTH_USERNAME'),
      password: value('GOTENBERG_API_BASIC_AUTH_PASSWORD'),
      timeoutMs,
    }
  }
  throw new PdfConfigError(['PDF_RENDERER'])
}
