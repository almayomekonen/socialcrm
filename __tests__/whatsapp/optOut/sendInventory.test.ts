import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Phase 0 Item 3, static: no WhatsApp message to a customer can be sent without
 * passing the opt-out gate, and nothing but a rep's own action may claim to be
 * manual. A new sender added later fails here until it is classified.
 */

const ROOT = process.cwd()
const SOURCE_DIRS = ['lib', 'db', 'actions', 'app', 'components', 'config', 'scripts']

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|cjs|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full)
  }
  return out
}
const files = SOURCE_DIRS.flatMap((d) => walk(path.join(ROOT, d))).map((f) => ({
  rel: path.relative(ROOT, f),
  src: fs.readFileSync(f, 'utf8'),
}))

describe('the Graph /messages endpoint', () => {
  it('is called only by the two gated customer primitives and the two platform (owner) senders', () => {
    const callers = files.filter((f) => /\/messages`/.test(f.src) && /fetch\(/.test(f.src)).map((f) => f.rel).sort()
    expect(callers).toEqual(
      [
        'lib/whatsapp/platform/sendReminder.ts', // platform number → business owners; own opt-out
        'lib/whatsapp/platform/sendText.ts', // platform number → business owners; own opt-out
        'lib/whatsapp/sendMessage.ts',
        'lib/whatsapp/sendTemplateMessage.ts',
      ].sort(),
    )
  })

  it('both customer primitives route every request through the gate', () => {
    for (const rel of ['lib/whatsapp/sendMessage.ts', 'lib/whatsapp/sendTemplateMessage.ts']) {
      const src = files.find((f) => f.rel === rel)!.src
      expect(src).toMatch(/runGatedWhatsappSend\(args\.consent, args\.to,/)
    }
  })
})

describe('every call into a customer primitive declares a consent', () => {
  const CALL = /\b(?:sendWhatsappText|sendWhatsappInteractive|sendWhatsappTemplate|deps\.send|send)\(\{/g
  const sites = files
    .filter((f) => /sendWhatsapp(Text|Interactive|Template)|typeof sendWhatsappText|WhatsappDeps/.test(f.src))
    .filter((f) => !['lib/whatsapp/sendMessage.ts', 'lib/whatsapp/sendTemplateMessage.ts', 'lib/whatsapp/optOut/sendGate.ts'].includes(f.rel))
    .flatMap((f) => [...f.src.matchAll(CALL)].map((m) => ({ rel: f.rel, call: f.src.slice(m.index!, m.index! + 900) })))
    .filter((s) => /phoneNumberId/.test(s.call.slice(0, 400)))

  it('the inventory is the expected set of senders', () => {
    expect([...new Set(sites.map((s) => s.rel))].sort()).toEqual(
      [
        'actions/whatsapp/sendWhatsappReply.ts',
        'actions/whatsapp/templates/sendTemplateToLead.ts',
        'lib/automations/executors/whatsapp.ts',
        'lib/inbox/autoresponse/ireSend.ts',
        'lib/inbox/autoresponse/worker.ts',
        'lib/weddingRsvp/invite.ts',
        'lib/weddingRsvp/reply.ts',
        'lib/weddingRsvp/rsvpRequest.ts',
        'lib/weddingRsvp/sendRsvp.ts',
      ].sort(),
    )
  })

  it.each(sites.map((s) => [s.rel, s]))('%s passes consent', (_rel, site) => {
    const objectEnd = site.call.indexOf('})')
    expect(site.call.slice(0, objectEnd)).toMatch(/consent:/)
  })
})

describe('manual consent is claimed only by a rep’s own action', () => {
  const claims = (kind: string) =>
    files.filter((f) => f.rel !== 'lib/whatsapp/optOut/sendGate.ts' && f.src.includes(`kind: '${kind}'`)).map((f) => f.rel)

  it('manual_reply: only the composer reply', () => {
    expect(claims('manual_reply')).toEqual(['actions/whatsapp/sendWhatsappReply.ts'])
  })
  it('manual_template: only the manual template action', () => {
    expect(claims('manual_template')).toEqual(['actions/whatsapp/templates/sendTemplateToLead.ts'])
  })
  it('wedding RSVP sends are automated (owner decision D4)', () => {
    for (const rel of ['lib/weddingRsvp/invite.ts', 'lib/weddingRsvp/reply.ts', 'lib/weddingRsvp/rsvpRequest.ts', 'lib/weddingRsvp/sendRsvp.ts']) {
      expect(files.find((f) => f.rel === rel)!.src).toMatch(/consent: \{ kind: 'automated'/)
    }
  })
})

describe('job runners default to the real, gated primitives', () => {
  it.each([
    ['lib/inbox/autoresponse/worker.ts', /send: opts\.deps\?\.send \?\? sendWhatsappText/],
    ['lib/inbox/autoresponse/questionnaire/worker.ts', /send: opts\.deps\?\.send \?\? sendWhatsappText/],
    ['lib/inbox/autoresponse/questionnaire/processJob.ts', /deps: QuestionnaireDeps = \{ send: sendWhatsappText \}/],
    ['lib/inbox/autoresponse/questionnaire/interactive.ts', /deps\.sendInteractive \?\? sendWhatsappInteractive/],
  ])('%s', (rel, re) => {
    expect(files.find((f) => f.rel === rel)!.src).toMatch(re)
  })
})
