/**
 * WhatsApp Agent — TWO send guards, neither bypassable.
 *
 * Every autonomous WhatsApp send must clear both, in this order, before Meta:
 *
 *   assertIreSendAllowed(agencyId, conversationId)   ← conversation is a legitimate
 *        ↓                                            target: exists, not personal,
 *        ↓                                            belongs to this agency
 *   assertAgentSendAllowed({ conversationId, … })    ← the agent still owns this turn:
 *        ↓                                            no human typing, no takeover
 *   WhatsApp send
 *
 * They answer different questions and neither substitutes for the other. The IRE
 * gate is the older invariant and must never be weakened or reordered behind the
 * presence guard; the presence guard is the newer one and must never be dropped.
 *
 * A safety boundary is only as good as its coverage. The rest of the suite proves
 * the two guards DECIDE correctly; this one fails the build when a third send path
 * appears, when either guard goes missing, or when a send is ordered before them.
 *
 * Structural on purpose: it reads the source rather than the behaviour, because
 * the failure it guards against is code that was never wired up to be tested.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const AGENT_DIR = join(process.cwd(), 'lib', 'inbox', 'autoresponse')

/** Anything that actually hands a message to Meta from inside the agent tree. */
const INVOKES_WHATSAPP = /(?:^|[^.\w])(?:await\s+(?:deps\.)?send\(|sendWhatsappText\(|sendWhatsappTemplate\()/

const IRE_GUARD = 'assertIreSendAllowed'
const PRESENCE_GUARD = 'assertAgentSendAllowed'

/**
 * The complete set of files permitted to call WhatsApp directly, each with the
 * reason it is allowed to. Adding a file here without BOTH guards in it fails
 * the assertions below.
 */
const GUARDED_SEND_SITES: Record<string, string> = {
  'ireSend.ts': 'the single IRE outbound path (qualify, closer, handoff, post-handoff, no-response)',
  'worker.ts': 'acknowledge-mode first contact, which does not route through ireSend',
}

function agentSources(): string[] {
  return readdirSync(AGENT_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
}

function bodyWithoutTypeRefs(file: string): string {
  // `send: typeof sendWhatsappText` is a type annotation, not a call.
  return readFileSync(join(AGENT_DIR, file), 'utf8')
    .split('\n')
    .filter((line) => !line.includes('typeof sendWhatsappText') && !line.trim().startsWith('import'))
    .join('\n')
}

describe('every autonomous WhatsApp send is guarded', () => {
  it('no file outside the known set calls WhatsApp directly', () => {
    const callers = agentSources().filter((f) => INVOKES_WHATSAPP.test(bodyWithoutTypeRefs(f)))
    expect(callers.sort()).toEqual(Object.keys(GUARDED_SEND_SITES).sort())
  })

  it('every send site enforces the EXISTING IRE guard', () => {
    // Predates Human Presence. Removing it would silently re-allow sends on
    // personal conversations and across agency boundaries.
    for (const file of Object.keys(GUARDED_SEND_SITES)) {
      const src = readFileSync(join(AGENT_DIR, file), 'utf8')
      expect(src, `${file} (${GUARDED_SEND_SITES[file]}) lost ${IRE_GUARD}`).toContain(IRE_GUARD)
    }
  })

  it('every send site enforces the Human Presence guard', () => {
    for (const file of Object.keys(GUARDED_SEND_SITES)) {
      const src = readFileSync(join(AGENT_DIR, file), 'utf8')
      expect(src, `${file} (${GUARDED_SEND_SITES[file]}) lost ${PRESENCE_GUARD}`).toContain(PRESENCE_GUARD)
    }
  })

  it('both guards run BEFORE the send, in IRE → presence order', () => {
    for (const file of Object.keys(GUARDED_SEND_SITES)) {
      const src = readFileSync(join(AGENT_DIR, file), 'utf8')
      const ireAt = src.indexOf(`await ${IRE_GUARD}`)
      const presenceAt = src.indexOf(`await ${PRESENCE_GUARD}`)
      expect(ireAt, `${file}: no awaited ${IRE_GUARD}`).toBeGreaterThan(-1)
      expect(presenceAt, `${file}: no awaited ${PRESENCE_GUARD}`).toBeGreaterThan(-1)

      // IRE first: establish the conversation is a legitimate target before
      // spending a presence read on it.
      expect(presenceAt, `${file}: presence guard must follow the IRE guard`).toBeGreaterThan(ireAt)

      // No send may precede either guard.
      const body = bodyWithoutTypeRefs(file)
      const sendAt = body.search(INVOKES_WHATSAPP)
      expect(sendAt, `${file}: no send found`).toBeGreaterThan(-1)
      expect(src.slice(0, ireAt).search(INVOKES_WHATSAPP), `${file}: a send precedes the IRE guard`).toBe(-1)
      expect(src.slice(0, presenceAt).search(INVOKES_WHATSAPP), `${file}: a send precedes the presence guard`).toBe(-1)
    }
  })

  it('neither guard can be short-circuited by the other failing open', () => {
    // Each guard's failure must return/skip, not fall through to the send.
    for (const file of Object.keys(GUARDED_SEND_SITES)) {
      const src = readFileSync(join(AGENT_DIR, file), 'utf8')
      expect(src, `${file}: IRE guard result is not acted on`).toMatch(/sendGate\.ok === false|gate\.ok === false/)
      expect(src, `${file}: presence guard result is not acted on`).toMatch(/presence\.authorized === false/)
    }
  })
})

describe('the guards themselves', () => {
  it('the IRE gate still exists as its own module', () => {
    const src = readFileSync(join(AGENT_DIR, 'ireSendGate.ts'), 'utf8')
    expect(src).toContain(`export async function ${IRE_GUARD}`)
    // Its two invariants, in its own words.
    expect(src).toMatch(/isPersonal/)
    expect(src).toMatch(/agencyId/)
  })

  it('the presence guard reads presence itself and accepts no caller-supplied verdict', () => {
    // If the boundary ever took pre-loaded facts, a stale read from earlier in the
    // turn could authorize a send the world had already invalidated.
    const src = readFileSync(join(AGENT_DIR, 'agentSendGuard.ts'), 'utf8')
    expect(src).toContain('readHumanPresence')
    expect(src).not.toMatch(/facts\s*:\s*HumanPresenceFacts/)
  })

  it('they remain separate functions — not merged into one abstraction', () => {
    // Two invariants, two answers, two reason vocabularies. Merging them would
    // make it impossible to tell which one refused, and why.
    expect(readdirSync(AGENT_DIR)).toContain('ireSendGate.ts')
    expect(readdirSync(AGENT_DIR)).toContain('agentSendGuard.ts')
  })
})
