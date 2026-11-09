import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Local stand-ins for the three outside services, on loopback only: the PDF
 * renderer (Gotenberg's route), R2 (under the real S3 client) and Meta. The
 * renderer can be held open, so a test decides exactly when a render finishes.
 */

export type GraphCall = { path: string; body: Record<string, any> }
export type StoredObject = { body: Buffer; sha256: string | null }

const PDF = Buffer.from('%PDF-1.7\n% quote after() harness\n%%EOF\n', 'latin1')
const read = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = []
    req.on('data', (c) => parts.push(c))
    req.on('end', () => resolve(Buffer.concat(parts)))
    req.on('error', reject)
  })

export async function startFakes() {
  const state = { renders: 0, firstRenderAt: 0, lastRenderAt: 0, graph: [] as GraphCall[], objects: new Map<string, StoredObject>() }
  let gate: Promise<void> | null = null
  let open: (() => void) | null = null
  let graphId = 0

  const server: Server = createServer(async (req, res) => {
    const url = req.url ?? ''
    try {
      if (url.endsWith('/forms/chromium/convert/html')) {
        await read(req)
        state.renders++
        state.lastRenderAt = Date.now()
        state.firstRenderAt ||= state.lastRenderAt
        if (gate) await gate
        if (res.destroyed) return
        res.writeHead(200, { 'content-type': 'application/pdf' }).end(PDF)
        return
      }
      if (url.startsWith('/r2/')) {
        const key = decodeURIComponent(url.slice(4).split('?')[0].split('/').slice(1).join('/'))
        if (req.method === 'PUT') {
          state.objects.set(key, { body: await read(req), sha256: (req.headers['x-amz-meta-sha256'] as string | undefined) ?? null })
          res.writeHead(200, { etag: '"after-harness"' }).end()
          return
        }
        const o = state.objects.get(key)
        res.writeHead(o ? 200 : 404).end(req.method === 'HEAD' ? undefined : o?.body)
        return
      }
      if (url.startsWith('/graph/')) {
        const raw = await read(req)
        state.graph.push({ path: url.slice(6), body: raw.length ? JSON.parse(raw.toString('utf8')) : {} })
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ success: true, messaging_product: 'whatsapp', messages: [{ id: `wamid.AFTER_${++graphId}` }] }))
        return
      }
      res.writeHead(404).end()
    } catch {
      res.destroy()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    state,
    port: (server.address() as AddressInfo).port,
    hold() {
      gate = new Promise<void>((resolve) => (open = resolve))
    },
    release() {
      open?.()
      gate = null
      open = null
    },
    close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  }
}
