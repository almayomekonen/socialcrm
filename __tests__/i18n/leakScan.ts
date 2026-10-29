/**
 * Finds Hebrew that a translated screen should not show.
 *
 * Checked: every text node, plus the attributes a user perceives
 * (aria-label, title, placeholder, alt). Hebrew is allowed ONLY where it is an
 * exact substring listed in the screen's `allowed` entries — values that are
 * data, not interface. Each entry carries a reason from a closed set, so a
 * reviewer can see why it is there:
 *
 *   customer-data  a value the fixture supplied as the CRM's own data
 *                  (a lead/user name, its initial) — rendered verbatim
 *   endonym        a language's own name (עברית), shown in its own script
 *                  in every interface language by design
 *   external       text supplied by a third party (Meta ad names, etc.)
 *   recorded-terms a consent / terms sentence recorded with its version when
 *                  the user agrees (Phase E4: the WhatsApp-reminders consent,
 *                  the card-storage and subscription consents) — shown exactly
 *                  as recorded, inside a declared Hebrew region
 *
 * No DOM marker is involved, so no component changes and nothing a component
 * does can opt itself out.
 */

export type AllowReason = 'customer-data' | 'endonym' | 'external' | 'recorded-terms'
export type Allowance = { text: string; reason: AllowReason }
export type Leak = { where: string; text: string }

const HEBREW = /[֐-׿]/
const ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt']

function stripAllowed(text: string, allowed: Allowance[], used: Set<string>): string {
  let rest = text
  // Longest first, so "דנה כהן" is removed before its initial "ד".
  for (const a of [...allowed].sort((x, y) => y.text.length - x.text.length)) {
    if (rest.includes(a.text)) {
      used.add(a.text)
      rest = rest.split(a.text).join(' ')
    }
  }
  return rest
}

export function findHebrewLeaks(root: Element, allowed: Allowance[], used = new Set<string>()): Leak[] {
  const leaks: Leak[] = []
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? ''
    if (HEBREW.test(stripAllowed(text, allowed, used))) {
      leaks.push({ where: `text in <${node.parentElement?.tagName.toLowerCase()}>`, text: text.trim() })
    }
  }
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of ATTRIBUTES) {
      const value = el.getAttribute(attr)
      if (value && HEBREW.test(stripAllowed(value, allowed, used))) {
        leaks.push({ where: `${attr} on <${el.tagName.toLowerCase()}>`, text: value })
      }
    }
  }
  return leaks
}
