import { NextResponse } from 'next/server'

/**
 * CSP violation collector.
 *
 * WHY THIS EXISTS. The app has shipped `Content-Security-Policy-Report-Only`
 * for some time, with a comment promising it would flip to enforcing "once real
 * traffic proves the allowlist complete". Nothing was ever collecting that
 * proof: the policy carried no `report-uri` and no `report-to`, so every
 * violation went to a console nobody was reading. The report-only period
 * produced exactly zero evidence, which is why the allowlist still contained
 * two provable holes (see next.config.mjs).
 *
 * WHAT IT DOES. Accepts the browser's violation report, logs one compact line,
 * and returns 204. Deliberately dumb: no DB write, no auth, no fan-out.
 *
 * NO AUTHENTICATION, BY PROTOCOL. Browsers post violation reports without
 * credentials and ignore the response body, so this endpoint cannot be behind a
 * session. That makes it publicly writable, which is why it stores nothing and
 * only logs — the worst an abuser achieves is noise in the log, bounded by the
 * size cap below. It exposes no data and mutates nothing.
 */

/** Reports are small; anything larger is not a browser and is dropped unread. */
const MAX_BYTES = 16_384

type Report = {
  'document-uri'?: string
  'effective-directive'?: string
  'violated-directive'?: string
  'blocked-uri'?: string
  disposition?: string
}

export async function POST(request: Request) {
  try {
    const raw = await request.text()
    if (!raw || raw.length > MAX_BYTES) return new NextResponse(null, { status: 204 })

    const parsed = JSON.parse(raw) as { 'csp-report'?: Report } | Report[]
    // Two wire formats: the legacy `report-uri` envelope and the newer
    // `report-to` batch. Normalise both to a list of report bodies.
    const reports: Report[] = Array.isArray(parsed)
      ? parsed.map((r) => (r as { body?: Report }).body ?? r)
      : parsed['csp-report']
        ? [parsed['csp-report']]
        : []

    for (const r of reports.slice(0, 10)) {
      console.info('[csp]', {
        disposition: r.disposition ?? 'unknown',
        directive: r['effective-directive'] ?? r['violated-directive'] ?? 'unknown',
        blocked: r['blocked-uri'] ?? 'unknown',
        document: r['document-uri'] ?? 'unknown',
      })
    }
  } catch {
    // A malformed report is not an incident worth a 500 — the browser would
    // only retry, and there is nothing here for the caller to fix.
  }

  return new NextResponse(null, { status: 204 })
}
