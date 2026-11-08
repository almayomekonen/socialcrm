import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

/**
 * Keeps each rendered PDF and its page images for a person to look at, because
 * text extraction cannot prove right-to-left layout. Local and git-ignored; the
 * harness never publishes them. Remove with: rm -rf .quote-cloud-artifacts
 */

const sh = promisify(execFile)
type Entry = { scenario: string; description: string; pdf: string; images: string[]; bytes: number; sha256: string }

export function createArtifacts(mode: string) {
  const dir = process.env.QUOTE_CLOUD_ARTIFACT_DIR || path.join('.quote-cloud-artifacts', mode)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const entries: Entry[] = []

  return {
    dir,
    async save(scenario: string, description: string, bytes: Uint8Array) {
      if (!/^[a-z0-9-]+$/.test(scenario) || entries.some((e) => e.scenario === scenario)) throw new Error(`bad or repeated scenario name: ${scenario}`)
      const pdf = `${scenario}.pdf`
      writeFileSync(path.join(dir, pdf), bytes, { mode: 0o600 })
      await sh('pdftoppm', ['-r', '100', '-png', path.join(dir, pdf), path.join(dir, scenario)])
      const images = readdirSync(dir).filter((f) => f.startsWith(`${scenario}-`) && f.endsWith('.png')).sort()
      if (!images.length) throw new Error(`no page images for ${scenario}`)
      entries.push({ scenario, description, pdf, images, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') })
    },
    writeIndex() {
      const rows = entries.map((e) => `| ${e.scenario} | ${e.description} | ${e.images.length} | ${e.pdf} | ${e.images.join(', ')} |`)
      writeFileSync(path.join(dir, 'INDEX.md'), ['# Quote PDF review (synthetic data)', '', `Mode: ${mode}. Check right-to-left order, numbers, ₪, wrapping and page breaks.`, '', '| Scenario | What to check | Pages | PDF | Images |', '|---|---|---|---|---|', ...rows, '', 'Remove with: rm -rf .quote-cloud-artifacts', ''].join('\n'), { mode: 0o600 })
      writeFileSync(path.join(dir, 'index.json'), JSON.stringify(entries, null, 2), { mode: 0o600 })
    },
    entries,
  }
}
