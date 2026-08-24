/**
 * `lib/leads/leadScope` — the URL contract for the desktop lead list.
 *
 * Pure: no DB, no framework. These are the guards that stop a querystring from
 * reaching PostgreSQL as an `integer`, and the single answer to "is this list
 * narrowed right now" that the server query and the empty state both read.
 */
import { describe, it, expect } from 'vitest'
import { clearLeadScopeParams, clearLeadSearchParams, hasActiveLeadScope, parseLeadId, parseListId } from '@/lib/leads/leadScope'

describe('parseLeadId', () => {
  it('accepts a plain positive integer', () => {
    expect(parseLeadId('12')).toBe(12)
    expect(parseLeadId('1')).toBe(1)
    expect(parseLeadId('2147483647')).toBe(2147483647)
  })

  it('takes the first value when the param is repeated', () => {
    expect(parseLeadId(['7', '9'])).toBe(7)
  })

  it('rejects anything that is not an id — never reaches SQL as an integer', () => {
    // The reported crash: a Hebrew name in ?clientId= is `22P02 invalid input
    // syntax for type integer`, which takes down the whole page render.
    expect(parseLeadId('ספי ברהנה')).toBeNull()
    expect(parseLeadId('abc')).toBeNull()
    expect(parseLeadId('12abc')).toBeNull()
    expect(parseLeadId('1;DROP TABLE clients')).toBeNull()
  })

  it('rejects the numeric-looking values Number() would have accepted', () => {
    expect(parseLeadId('12e3')).toBeNull()
    expect(parseLeadId('0x0c')).toBeNull()
    expect(parseLeadId('Infinity')).toBeNull()
    expect(parseLeadId('1.5')).toBeNull()
    expect(parseLeadId('-4')).toBeNull()
  })

  it('rejects out-of-range and empty values', () => {
    expect(parseLeadId('0')).toBeNull()
    expect(parseLeadId('2147483648')).toBeNull()
    expect(parseLeadId('')).toBeNull()
    expect(parseLeadId(undefined)).toBeNull()
    expect(parseLeadId(null)).toBeNull()
  })

  it('parseListId applies the same rule — client_lists.id is also integer', () => {
    expect(parseListId('3')).toBe(3)
    expect(parseListId('nope')).toBeNull()
  })
})

describe('hasActiveLeadScope', () => {
  it('is false for an unscoped list', () => {
    expect(hasActiveLeadScope({})).toBe(false)
    expect(hasActiveLeadScope(null)).toBe(false)
    expect(hasActiveLeadScope({ pageNum: '2', tableLimit: '100' })).toBe(false)
  })

  it('is true for each scoping parameter', () => {
    expect(hasActiveLeadScope({ clientId: '12' })).toBe(true)
    expect(hasActiveLeadScope({ listId: '3' })).toBe(true)
    expect(hasActiveLeadScope({ view: 'due' })).toBe(true)
  })

  it('does NOT count the mobile ?q= param — desktop never applies it', () => {
    // `getLeadsTable` reads `q` only from its explicit `filters` argument, never
    // from `params`. Counting it here would describe a narrowing the desktop
    // query does not perform.
    expect(hasActiveLeadScope({ q: 'ספי' })).toBe(false)
  })

  it('does NOT count an unparseable id as a scope', () => {
    // The query ignores it, so the empty state must not claim a narrowing that
    // is not applied — it would describe a filter the user cannot clear.
    expect(hasActiveLeadScope({ clientId: 'ספי ברהנה' })).toBe(false)
    expect(hasActiveLeadScope({ listId: 'abc' })).toBe(false)
  })
})

describe('clearLeadSearchParams', () => {
  it('drops the picked lead, its display text and the stale page offset', () => {
    const out = clearLeadSearchParams(new URLSearchParams('clientId=12&clientDetails=%D7%A1%D7%A4%D7%99&pageNum=2'))
    expect(out.toString()).toBe('')
  })

  it('leaves every other parameter alone', () => {
    const out = clearLeadSearchParams(new URLSearchParams('clientId=12&listId=3&tableLimit=500'))
    expect(out.get('listId')).toBe('3')
    expect(out.get('tableLimit')).toBe('500')
    expect(out.get('clientId')).toBeNull()
  })
})

describe('clearLeadScopeParams', () => {
  it('lifts every narrowing, not just the search box', () => {
    const out = clearLeadScopeParams(new URLSearchParams('clientId=12&clientDetails=x&listId=3&view=due&pageNum=4'))
    expect(out.toString()).toBe('')
  })

  it('still leaves unrelated parameters alone', () => {
    const out = clearLeadScopeParams(new URLSearchParams('view=due&tableLimit=500'))
    expect(out.get('tableLimit')).toBe('500')
    expect(out.get('view')).toBeNull()
  })
})
