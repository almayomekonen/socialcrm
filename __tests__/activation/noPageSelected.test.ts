import { describe, it, expect } from 'vitest'
import { FB_REASON, FB_REASON_NOTICE_CODE } from '@/lib/connections/reasons'
import { FACEBOOK_NOTICES, facebookNotice } from '@/lib/connections/messages'

/**
 * "We couldn't find a Page" was being shown to a user whose Facebook account is
 * completely fine.
 *
 * Production agency 131 (1 Sep) reached the generic NO_PAGES screen with these
 * diagnostics: `pagesShowListGranted: true`, `granularPagesEntryPresent: true`,
 * `grantedPageIdCount: null`, `returnedPageCount: 0`. The token itself says the
 * permission was granted and scoped to zero Pages — the user pressed through
 * Meta's consent screen without ticking a Page.
 *
 * That is a DIFFERENT situation from "Meta returned no Page", and it has a
 * different fix: one checkbox on the next attempt, not an audit of the account.
 * This is the only Meta change in this slice; the OAuth architecture and the
 * 20 Aug discovery fix are untouched.
 */
describe('no_page_selected — distinct from no_pages', () => {
  it('has its own reason code mapped to its own notice', () => {
    expect(FB_REASON.NO_PAGE_SELECTED).toBe('NO_PAGE_SELECTED')
    expect(FB_REASON_NOTICE_CODE[FB_REASON.NO_PAGE_SELECTED]).toBe('no_page_selected')
    expect(FB_REASON_NOTICE_CODE[FB_REASON.NO_PAGE_SELECTED]).not.toBe(
      FB_REASON_NOTICE_CODE[FB_REASON.NO_PAGES],
    )
  })

  it('resolves to a real notice through the component-facing lookup', () => {
    const notice = facebookNotice('no_page_selected')
    expect(notice).toBeTruthy()
    expect(notice).not.toEqual(FACEBOOK_NOTICES.no_pages)
  })

  it('names the actual cause — the consent screen — and the one-step fix', () => {
    const n = FACEBOOK_NOTICES.no_page_selected
    expect(n.title).toContain('לא נבחר דף')
    expect(n.nextStep).toContain('לסמן')
    expect(n.action).toBeTruthy()
  })

  it('does not send the user to audit an account that is working', () => {
    const n = FACEBOOK_NOTICES.no_page_selected
    const all = [n.title, n.explanation, n.nextStep, ...(n.reasons ?? [])].join(' ')
    // The no_pages copy hedges about the account and about the Page existing at
    // all, because there it genuinely cannot know. Here it can.
    expect(all).not.toContain('שאינו מנהל את הדף')
    expect(all).not.toContain('אם עדיין אין דף עסקי')
  })

  it('is calmer than a hard failure — the connection itself worked', () => {
    expect(FACEBOOK_NOTICES.no_page_selected.tone).toBe('attention')
    expect(FACEBOOK_NOTICES.no_pages.tone).toBe('error')
  })

  it('leaves the existing no_pages copy untouched', () => {
    expect(FACEBOOK_NOTICES.no_pages.title).toBe('לא מצאנו דף Facebook שאפשר לחבר')
  })
})
