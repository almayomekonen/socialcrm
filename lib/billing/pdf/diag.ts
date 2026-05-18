import { appendFileSync, readFileSync, existsSync, statSync, unlinkSync } from 'node:fs'

const DIAG_FILE = '/tmp/render-diag.log'

const MAX_BYTES = 256 * 1024

export function diag(step: string, detail?: Record<string, unknown>): void {
  try {
    if (existsSync(DIAG_FILE)) {
      const size = statSync(DIAG_FILE).size
      if (size > MAX_BYTES) {
        try {
          unlinkSync(DIAG_FILE)
        } catch {
        }
      }
    }
    const line = JSON.stringify({ t: new Date().toISOString(), step, ...(detail ?? {}) }) + '\n'
    appendFileSync(DIAG_FILE, line, 'utf8')
  } catch {
    try {
      console.log(`[diag-fallback] ${step}`, JSON.stringify(detail ?? {}))
    } catch {
    }
  }
}

export function readDiag(): string {
  try {
    return readFileSync(DIAG_FILE, 'utf8')
  } catch (err) {
    return `(no diag file: ${err instanceof Error ? err.message : String(err)})`
  }
}

export function clearDiag(): void {
  try {
    if (existsSync(DIAG_FILE)) unlinkSync(DIAG_FILE)
  } catch {
  }
}
