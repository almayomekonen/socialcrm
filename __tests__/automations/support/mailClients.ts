import { JSDOM } from 'jsdom'

/**
 * Phase 0 of the automation-email rendering work: a mail-client SIMULATOR.
 *
 * The defect this exists to catch cannot be seen by asserting on the raw HTML
 * string. `renderAutomationEmail` declares `dir="rtl"` on `<html>` — and Gmail,
 * Outlook.com and Yahoo extract the message body into their OWN document,
 * discarding that wrapper. The direction then comes from the recipient's client
 * UI language, which the sender does not control: the audit measured a Hebrew
 * greeting whose word order INVERTS when the host container is LTR.
 *
 * A test that asserts `html.toContain('dir="rtl"')` passes on that bug. So this
 * module models what each client actually does to the markup, and resolves the
 * base direction the way the bidi algorithm does — by walking up for an explicit
 * `dir`, falling back to the HOST, not to the email's wishes.
 *
 * Structural, not visual: no layout engine is needed to know which direction a
 * paragraph inherits, and jsdom has none. The audit's numeric glyph-position
 * proof lives in `scripts/emailBidiProof.mjs` for verification runs.
 */

export type MailClient = {
  name: string
  /**
   * False for clients that re-host the body in their own document, discarding
   * `<html>`/`<head>` — and with them any `dir`, `lang` or `<style>` there.
   */
  keepsDocumentWrapper: boolean
  /**
   * The base direction of the container the message is re-hosted in. Driven by
   * the RECIPIENT's UI language, so both values are real for the same email.
   * Only meaningful when `keepsDocumentWrapper` is false.
   */
  hostDirection: 'rtl' | 'ltr'
  /** Word-engine and Outlook.com behaviour: `white-space` is not honoured. */
  dropsWhiteSpace: boolean
  /** Word engine: padding and max-width on `<table>` are ignored. */
  ignoresTableBoxModel: boolean
}

export const GMAIL_HEBREW_UI: MailClient = {
  name: 'Gmail — recipient UI Hebrew (RTL host)',
  keepsDocumentWrapper: false,
  hostDirection: 'rtl',
  dropsWhiteSpace: false,
  ignoresTableBoxModel: false,
}

/**
 * The same email, same recipient inbox provider, different UI language. This is
 * the profile that exposes the P0 — and the one the sender can never observe,
 * because their own Gmail is Hebrew.
 */
export const GMAIL_ENGLISH_UI: MailClient = {
  ...GMAIL_HEBREW_UI,
  name: 'Gmail — recipient UI English (LTR host)',
  hostDirection: 'ltr',
}

export const APPLE_MAIL: MailClient = {
  name: 'Apple Mail',
  keepsDocumentWrapper: true,
  hostDirection: 'ltr',
  dropsWhiteSpace: false,
  ignoresTableBoxModel: false,
}

export const OUTLOOK_COM: MailClient = {
  name: 'Outlook.com',
  keepsDocumentWrapper: false,
  hostDirection: 'ltr',
  dropsWhiteSpace: true,
  ignoresTableBoxModel: false,
}

export const OUTLOOK_DESKTOP: MailClient = {
  name: 'Outlook desktop (Word engine)',
  keepsDocumentWrapper: true,
  hostDirection: 'ltr',
  dropsWhiteSpace: true,
  ignoresTableBoxModel: true,
}

/** First-class targets: every invariant must hold in all of these. */
export const FIRST_CLASS_CLIENTS = [GMAIL_HEBREW_UI, GMAIL_ENGLISH_UI, APPLE_MAIL] as const

/**
 * Best-effort targets. Only the portable invariants are asserted here — real
 * `<br>` markup, no padding on `<table>`, one-directional margins. MSO ghost
 * tables are explicitly out of scope, so full-width layout in Outlook desktop
 * is an accepted limitation, not a test failure.
 */
export const BEST_EFFORT_CLIENTS = [OUTLOOK_COM, OUTLOOK_DESKTOP] as const

export type Delivered = {
  client: MailClient
  /** The element the surviving markup hangs from. */
  root: HTMLElement
  /**
   * The simulated CLIENT container, when the email was re-hosted — i.e. the
   * boundary the email's own markup ends at. Null when the wrapper survived.
   *
   * Assertions about what the EMAIL declares must stop here: the container's
   * `dir` belongs to the recipient's client, and treating it as the email's own
   * would make those assertions unfailable.
   */
  hostContainer: HTMLElement | null
  document: Document
  /**
   * Elements that render author-visible copy — those with a direct non-empty
   * text child. These are what typography invariants apply to.
   */
  textBlocks: HTMLElement[]
  /** Base direction this element actually resolves to in this client. */
  effectiveDir: (el: Element) => 'rtl' | 'ltr'
}

const RTL_RANGE = /[֐-ࣿיִ-﷿ﹰ-﻿]/
const LTR_RANGE = /[A-Za-zÀ-˿Ͱ-֏]/

/**
 * UBA rules P2/P3, reduced to what `dir="auto"` needs: the first STRONG
 * directional character decides, and text with none is LTR.
 */
export function firstStrongDirection(text: string): 'rtl' | 'ltr' | null {
  for (const ch of text) {
    if (RTL_RANGE.test(ch)) return 'rtl'
    if (LTR_RANGE.test(ch)) return 'ltr'
  }
  return null
}

/** Strip a single declaration from every inline style in the tree. */
function dropDeclaration(root: ParentNode, property: string): void {
  for (const el of root.querySelectorAll<HTMLElement>('[style]')) {
    el.style.removeProperty(property)
  }
}

/**
 * Put a rendered email through one client's treatment and hand back the DOM the
 * recipient would actually have.
 */
export function deliver(html: string, client: MailClient): Delivered {
  const source = new JSDOM(html).window.document
  const host = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>').window.document
  const hostEl = host.getElementById('host') as HTMLElement

  let root: HTMLElement
  if (client.keepsDocumentWrapper) {
    // The document survives: whatever `<html dir>` says still governs.
    root = source.documentElement as HTMLElement
  } else {
    // Re-hosted: only body-internal markup survives, under the client's own
    // container direction.
    hostEl.setAttribute('dir', client.hostDirection)
    hostEl.innerHTML = source.body.innerHTML
    root = hostEl
  }

  if (client.dropsWhiteSpace) dropDeclaration(root, 'white-space')
  if (client.ignoresTableBoxModel) {
    for (const table of root.querySelectorAll<HTMLElement>('table[style]')) {
      table.style.removeProperty('padding')
      table.style.removeProperty('max-width')
    }
  }

  const textBlocks = [...root.querySelectorAll<HTMLElement>('*')].filter((el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0),
  )

  const effectiveDir = (el: Element): 'rtl' | 'ltr' => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const dir = node.getAttribute?.('dir')?.toLowerCase()
      if (dir === 'rtl' || dir === 'ltr') return dir
      if (dir === 'auto') return firstStrongDirection(node.textContent ?? '') ?? 'ltr'
    }
    // Nothing declared it. An LTR host is the browser default, and for a
    // re-hosted message that host is the recipient's client.
    return client.keepsDocumentWrapper ? 'ltr' : client.hostDirection
  }

  return {
    client,
    root,
    hostContainer: client.keepsDocumentWrapper ? null : hostEl,
    document: client.keepsDocumentWrapper ? source : host,
    textBlocks,
    effectiveDir,
  }
}

/** Inline-style helper: the declared value, or '' when absent. */
export const declared = (el: HTMLElement, property: string): string => el.style.getPropertyValue(property).trim()

/**
 * Does the EMAIL itself declare a direction for this element — on the element or
 * an ancestor, stopping at the client container so the recipient's own `dir` is
 * never mistaken for the email's.
 */
export function emailDeclaresDir(el: Element, boundary: Element | null): boolean {
  for (let n: Element | null = el; n && n !== boundary; n = n.parentElement) {
    const dir = n.getAttribute?.('dir')?.toLowerCase()
    if (dir === 'rtl' || dir === 'ltr' || dir === 'auto') return true
  }
  return false
}
