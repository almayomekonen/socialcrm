'use strict'
/**
 * Preloaded (NODE_OPTIONS=--require) into `next build` and `next start` for the
 * real-after() harness. Runs before any application code.
 *
 *   - Refuses to start unless the database is the local socialcrm_quotes_test.
 *   - Every socket and fetch is loopback-only; anything else is refused and logged,
 *     so a Production database or a real service cannot be reached by any path.
 *   - Meta and R2 never leave the machine: their requests are sent to the local fake.
 *
 * AFTER_ALLOW_HOSTS exists for `next build` alone (Google Fonts). The server never sets it.
 */
const fs = require('node:fs')
const net = require('node:net')
const http = require('node:http')
const https = require('node:https')

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])
const EXPECTED_DB = '/socialcrm_quotes_test'
const fakePort = process.env.AFTER_FAKE_PORT
const refusalsFile = process.env.AFTER_REFUSALS_FILE
const extraHosts = (process.env.AFTER_ALLOW_HOSTS || '').split(',').filter(Boolean)

function fatal(reason) {
  console.error(`[after guard] refused to start: ${reason}`)
  process.exit(78)
}

let db
try {
  db = new URL(process.env.DATABASE_URL || '')
} catch {
  fatal('DATABASE_URL is not a URL')
}
if (!LOOPBACK.has(db.hostname) || db.pathname !== EXPECTED_DB) fatal('the database is not the local socialcrm_quotes_test')
if (process.env.VERCEL || process.env.CI) fatal('not on Vercel or CI')

const allowed = (host) => LOOPBACK.has(host) || extraHosts.includes(host)
function refuse(what) {
  if (refusalsFile) fs.appendFileSync(refusalsFile, `${what}\n`)
  return new Error(`[after guard] refused ${what}`)
}

const realConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const isUnix = typeof first === 'string' || (typeof first === 'object' && first !== null && Boolean(first.path))
  if (!isUnix) {
    const host = typeof first === 'object' && first !== null ? (first.host || 'localhost') : typeof args[1] === 'string' ? args[1] : 'localhost'
    if (!allowed(host)) throw refuse(`socket:${host}`)
  }
  return realConnect.apply(this, args)
}

const R2_HOST = /\.r2\.cloudflarestorage\.com$/
const realHttpsRequest = https.request
https.request = function (options, ...rest) {
  const host = typeof options === 'object' && options !== null && !(options instanceof URL) ? options.hostname || options.host : new URL(String(options)).hostname
  if (fakePort && typeof options === 'object' && R2_HOST.test(String(host))) {
    return http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port: fakePort, agent: undefined, path: `/r2${options.path}` }, ...rest)
  }
  return realHttpsRequest.call(this, options, ...rest)
}

const realFetch = globalThis.fetch
globalThis.fetch = function (input, init) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const url = new URL(raw)
  if (allowed(url.hostname)) return realFetch(input, init)
  if (fakePort && url.hostname === 'graph.facebook.com') {
    const target = `http://127.0.0.1:${fakePort}/graph${url.pathname}${url.search}`
    return typeof input === 'string' || input instanceof URL ? realFetch(target, init) : realFetch(new Request(target, input), init)
  }
  return Promise.reject(refuse(`fetch:${url.hostname}`))
}
