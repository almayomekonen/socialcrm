/**
 * `lib/leads/leadScope` — the URL contract for the desktop lead list.
 *
 * Pure: no DB, no framework. These are the guards that stop a querystring from
 * reaching PostgreSQL as an `integer`, and the single answer to "is this list
 * narrowed right now" that the server query and the empty state both read.
 */
import { describe, it, expect } from 'vitest'
import {
  clearLeadScopeParams,
  clearLeadSearchParams,
  hasActiveLeadScope,
  parseLeadSearch,
  parseListId,
  withLeadSearch,
} from '@/lib/leads/leadScope'

describe('parseListId', () => {
  it('accepts a plain positive integer', () => {
    expect(parseListId('12')).toBe(12)
    expect(parseListId('1')).toBe(1)
    expect(parseListId('2147483647')).toBe(2147483647)
  })

  it('takes the first value when the param is repeated', () => {
    expect(parseListId(['7', '9'])).toBe(7)
  })

  it('rejects anything that is not an id — never reaches SQL as an integer', () => {
    // `22P02 invalid input syntax for type integer` takes down the whole page
    // render, so a non-numeric id must never reach SQL.
    expect(parseListId('ספי ברהנה')).toBeNull()
    expect(parseListId('abc')).toBeNull()
    expect(parseListId('12abc')).toBeNull()
    expect(parseListId('1;DROP TABLE clients')).toBeNull()
  })

  it('rejects the numeric-looking values Number() would have accepted', () => {
    expect(parseListId('12e3')).toBeNull()
    expect(parseListId('0x0c')).toBeNull()
    expect(parseListId('Infinity')).toBeNull()
    expect(parseListId('1.5')).toBeNull()
    expect(parseListId('-4')).toBeNull()
  })

  it('rejects out-of-range and empty values', () => {
    expect(parseListId('0')).toBeNull()
    expect(parseListId('2147483648')).toBeNull()
    expect(parseListId('')).toBeNull()
    expect(parseListId(undefined)).toBeNull()
    expect(parseListId(null)).toBeNull()
  })

  it('guards the client_lists lookup — a bad id never reaches an integer column', () => {
    expect(parseListId('3')).toBe(3)
    expect(parseListId('nope')).toBeNull()
  })
})

describe('hasActiveLeadScope', () => {
  it('is false for an unfiltered workspace', () => {
    expect(hasActiveLeadScope({})).toBe(false)
    expect(hasActiveLeadScope(null)).toBe(false)
    expect(hasActiveLeadScope({ pageNum: '2', tableLimit: '100' })).toBe(false)
  })

  it('is true for each narrowing the user can clear', () => {
    expect(hasActiveLeadScope({ q: 'ספי' })).toBe(true)
    expect(hasActiveLeadScope({ listId: '3' })).toBe(true)
    expect(hasActiveLeadScope({ view: 'due' })).toBe(true)
  })

  it('does NOT count a leftover clientId — nothing writes it and the query ignores it', () => {
    expect(hasActiveLeadScope({ clientId: '12' })).toBe(false)
  })

  it('ignores whitespace-only search terms', () => {
    expect(hasActiveLeadScope({ q: '   ' })).toBe(false)
  })
})

describe('parseLeadSearch', () => {
  it('returns the trimmed term, or empty', () => {
    expect(parseLeadSearch({ q: '  ספי ברהנה ' })).toBe('ספי ברהנה')
    expect(parseLeadSearch({})).toBe('')
    expect(parseLeadSearch(null)).toBe('')
  })

  it('takes the first value when the param is repeated', () => {
    expect(parseLeadSearch({ q: ['ספי', 'אחר'] })).toBe('ספי')
  })
})

describe('withLeadSearch', () => {
  it('sets the term, resets the page offset and preserves everything else', () => {
    const out = withLeadSearch(new URLSearchParams('listId=3&view=due&tableLimit=500&pageNum=4'), 'ספי ברהנה')
    expect(out.get('q')).toBe('ספי ברהנה')
    expect(out.get('listId')).toBe('3')
    expect(out.get('view')).toBe('due')
    expect(out.get('tableLimit')).toBe('500')
    expect(out.get('pageNum')).toBeNull()
  })

  it('sweeps out legacy clientId/clientDetails from a bookmarked URL', () => {
    const out = withLeadSearch(new URLSearchParams('clientId=7&clientDetails=x'), 'ספי')
    expect(out.get('clientId')).toBeNull()
    expect(out.get('clientDetails')).toBeNull()
  })

  it('an empty term removes the search', () => {
    expect(withLeadSearch(new URLSearchParams('q=ספי&listId=3'), '').toString()).toBe('listId=3')
  })
})

describe('clearLeadSearchParams', () => {
  it('clears the search but leaves other narrowings alone', () => {
    const out = clearLeadSearchParams(new URLSearchParams('q=ספי&listId=3&view=due&pageNum=2'))
    expect(out.get('q')).toBeNull()
    expect(out.get('pageNum')).toBeNull()
    expect(out.get('listId')).toBe('3')
    expect(out.get('view')).toBe('due')
  })
})

describe('clearLeadScopeParams', () => {
  it('lifts every narrowing, not just the search box', () => {
    const out = clearLeadScopeParams(new URLSearchParams('q=ספי&listId=3&view=due&pageNum=4'))
    expect(out.toString()).toBe('')
  })

  it('still leaves unrelated parameters alone', () => {
    const out = clearLeadScopeParams(new URLSearchParams('view=due&tableLimit=500'))
    expect(out.get('tableLimit')).toBe('500')
    expect(out.get('view')).toBeNull()
  })
})
