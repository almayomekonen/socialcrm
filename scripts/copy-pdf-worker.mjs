// Copies pdfjs-dist's worker into /public so the copilot client extractor can
// reference it via an absolute, route-independent URL.
//
// Why this exists:
//   - pdfjs-dist v4 requires GlobalWorkerOptions.workerSrc to point at a real
//     loadable worker. `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`
//     is not bundler-rewritten by Next.js 16 + Turbopack for bare module
//     specifiers, so the URL ends up resolved relative to the current route
//     (e.g. /clients/[id]/pdf.worker.mjs) and 404s.
//   - The fake-worker fallback parses on the main thread and is explicitly
//     undesired here.
//
// Behavior:
//   - Reads the version of pdfjs-dist resolved at the project root.
//   - Copies node_modules/pdfjs-dist/build/pdf.worker.min.mjs into
//     public/copilot/pdf.worker.min.mjs.
//   - Writes a sibling .version file so re-runs are skipped when the source
//     hasn't changed. Safe to run on every install / build.
//
// Wired from package.json scripts: postinstall + prebuild.

import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const targetDir = path.join(projectRoot, 'public', 'copilot')
const targetWorker = path.join(targetDir, 'pdf.worker.min.mjs')
const targetVersion = path.join(targetDir, 'pdf.worker.min.mjs.version')

const require = createRequire(import.meta.url)

async function main() {
  let pdfjsPkgPath
  try {
    pdfjsPkgPath = require.resolve('pdfjs-dist/package.json', { paths: [projectRoot] })
  } catch {
    console.warn('[copy-pdf-worker] pdfjs-dist not installed yet, skipping. (Will run again next install.)')
    return
  }

  const pdfjsRoot = path.dirname(pdfjsPkgPath)
  const pkg = JSON.parse(await fs.readFile(pdfjsPkgPath, 'utf8'))
  const version = String(pkg.version)
  const sourceWorker = path.join(pdfjsRoot, 'build', 'pdf.worker.min.mjs')

  try {
    await fs.access(sourceWorker)
  } catch {
    console.warn(`[copy-pdf-worker] missing source worker at ${sourceWorker} (pdfjs-dist@${version}), skipping`)
    return
  }

  const expectedStamp = `pdfjs-dist@${version}`
  let existingStamp = ''
  try {
    existingStamp = await fs.readFile(targetVersion, 'utf8')
  } catch {
    // no-op — first run
  }
  if (existingStamp.trim() === expectedStamp) {
    return
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(sourceWorker, targetWorker)
  await fs.writeFile(targetVersion, expectedStamp)
  console.info(`[copy-pdf-worker] copied ${expectedStamp} → public/copilot/pdf.worker.min.mjs`)
}

main().catch((err) => {
  console.error('[copy-pdf-worker] failed', err)
  process.exitCode = 1
})
