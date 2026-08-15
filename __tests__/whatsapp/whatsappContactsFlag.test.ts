import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  canUseWhatsappContacts,
  isWhatsappContactsAgencyAllowlisted,
  isWhatsappContactsEnabled,
} from '@/lib/flags/whatsappContactsFlags'

const ENV = process.env.WA_CONTACTS_ENABLED
const LIST = process.env.WA_CONTACTS_AGENCY_ALLOWLIST
const NODE = process.env.NODE_ENV

function setEnv(enabled?: string, allowlist?: string) {
  if (enabled === undefined) delete process.env.WA_CONTACTS_ENABLED
  else process.env.WA_CONTACTS_ENABLED = enabled
  if (allowlist === undefined) delete process.env.WA_CONTACTS_AGENCY_ALLOWLIST
  else process.env.WA_CONTACTS_AGENCY_ALLOWLIST = allowlist
}

beforeEach(() => {
  setEnv(undefined, undefined)
  ;(process.env as Record<string, string | undefined>).NODE_ENV = 'test'
})
afterEach(() => {
  setEnv(ENV, LIST)
  ;(process.env as Record<string, string | undefined>).NODE_ENV = NODE
})

describe('WA_CONTACTS gate', () => {
  test('unset env blocks everyone — shipping this changes nothing', () => {
    expect(isWhatsappContactsEnabled()).toBe(false)
    expect(canUseWhatsappContacts(69)).toBe(false)
  })

  test('master switch alone still admits nobody', () => {
    setEnv('1', undefined)
    expect(isWhatsappContactsEnabled()).toBe(true)
    expect(canUseWhatsappContacts(69)).toBe(false)
  })

  test('allowlist alone still admits nobody', () => {
    setEnv(undefined, '69')
    expect(isWhatsappContactsAgencyAllowlisted(69)).toBe(true)
    expect(canUseWhatsappContacts(69)).toBe(false)
  })

  test('both gates admit only the named agencies', () => {
    setEnv('1', '69, 12')
    expect(canUseWhatsappContacts(69)).toBe(true)
    expect(canUseWhatsappContacts(12)).toBe(true)
    expect(canUseWhatsappContacts(1)).toBe(false)
  })

  test('"all" requires the master switch', () => {
    setEnv(undefined, 'all')
    expect(canUseWhatsappContacts(999)).toBe(false)
    setEnv('1', 'all')
    expect(canUseWhatsappContacts(999)).toBe(true)
  })

  test('missing or zero agencyId never passes', () => {
    setEnv('1', 'all')
    expect(canUseWhatsappContacts(null)).toBe(false)
    expect(canUseWhatsappContacts(undefined)).toBe(false)
    expect(canUseWhatsappContacts(0)).toBe(false)
  })
})
