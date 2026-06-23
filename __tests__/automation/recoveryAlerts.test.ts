import { describe, it, expect } from 'vitest'
import { nameFrom } from '@/db/recoveryAlerts'

describe('nameFrom', () => {
  it('joins first and last', () => {
    expect(nameFrom('דנה', 'לוי')).toBe('דנה לוי')
  })
  it('uses first name alone when no last', () => {
    expect(nameFrom('דנה', null)).toBe('דנה')
  })
  it('falls back to ליד when nothing', () => {
    expect(nameFrom(null, null)).toBe('ליד')
  })
})
