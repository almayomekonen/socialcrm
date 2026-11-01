/**
 * The exact Embedded Signup launch parameters, per Meta's Versions page:
 *   v4: extras { featureType } (our build adds version 'v4'), SDK at the app Graph version
 *   v5: extras { version: 'v5' }, WhatsApp Business app onboarding ON by default,
 *       opt-out via features[{ name: 'whatsapp_business_app_onboarding', enabled: false }]
 * v5 initialises the SDK at a supported Graph version (v19.0 expired 2026-05-21).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { embeddedSignupLaunchFor, EMBEDDED_SIGNUP_SDK_VERSION, resolveEmbeddedSignupVersion } from '@/lib/facebook/embeddedSignupLaunch'

describe('resolveEmbeddedSignupVersion', () => {
  it('only the exact value v5 selects v5', () => {
    expect(resolveEmbeddedSignupVersion('v5')).toBe('v5')
    for (const raw of [undefined, '', 'v4', 'V5', ' v5', 'v6', '5', 'true']) expect(resolveEmbeddedSignupVersion(raw)).toBe('v4')
  })
})

describe('embeddedSignupLaunchFor', () => {
  it('v4 (default): unchanged production payload, SDK at the app Graph version', () => {
    expect(embeddedSignupLaunchFor({ version: 'v4', coexistenceDisabled: false, appGraphVersion: 'v19.0' })).toEqual({
      extras: { version: 'v4', featureType: 'whatsapp_business_app_onboarding' },
      sdkVersion: 'v19.0',
    })
  })

  it('v4 with Coexistence disabled: empty featureType (unchanged kill switch)', () => {
    expect(embeddedSignupLaunchFor({ version: 'v4', coexistenceDisabled: true, appGraphVersion: 'v19.0' }).extras).toEqual({ version: 'v4', featureType: '' })
  })

  it('v5: exactly { version: "v5" } (Business app onboarding is the Meta default), SDK at the latest Graph version', () => {
    const r = embeddedSignupLaunchFor({ version: 'v5', coexistenceDisabled: false, appGraphVersion: 'v19.0' })
    expect(r).toEqual({ extras: { version: 'v5' }, sdkVersion: 'v26.0' })
    expect(EMBEDDED_SIGNUP_SDK_VERSION).toBe('v26.0')
    expect(JSON.stringify(r.extras)).not.toMatch(/featureType|sessionInfoVersion|setup/)
  })

  it('v5 with Coexistence disabled: the documented Meta opt-out', () => {
    expect(embeddedSignupLaunchFor({ version: 'v5', coexistenceDisabled: true, appGraphVersion: 'v19.0' }).extras).toEqual({
      version: 'v5',
      features: [{ name: 'whatsapp_business_app_onboarding', enabled: false }],
    })
  })
})

describe('embeddedSignupLaunch reads the build-time switches', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('unset: v4', async () => {
    vi.stubEnv('NEXT_PUBLIC_WA_EMBEDDED_SIGNUP_VERSION', '')
    vi.resetModules()
    const { embeddedSignupLaunch } = await import('@/lib/facebook/embeddedSignupLaunch')
    expect(embeddedSignupLaunch('v19.0').extras).toEqual({ version: 'v4', featureType: 'whatsapp_business_app_onboarding' })
  })

  it('NEXT_PUBLIC_WA_EMBEDDED_SIGNUP_VERSION=v5: v5', async () => {
    vi.stubEnv('NEXT_PUBLIC_WA_EMBEDDED_SIGNUP_VERSION', 'v5')
    vi.resetModules()
    const { embeddedSignupLaunch } = await import('@/lib/facebook/embeddedSignupLaunch')
    expect(embeddedSignupLaunch('v19.0')).toEqual({ extras: { version: 'v5' }, sdkVersion: 'v26.0' })
  })

  it('v5 + NEXT_PUBLIC_WA_COEXISTENCE_DISABLED=1: the opt-out', async () => {
    vi.stubEnv('NEXT_PUBLIC_WA_EMBEDDED_SIGNUP_VERSION', 'v5')
    vi.stubEnv('NEXT_PUBLIC_WA_COEXISTENCE_DISABLED', '1')
    vi.resetModules()
    const { embeddedSignupLaunch } = await import('@/lib/facebook/embeddedSignupLaunch')
    expect(embeddedSignupLaunch('v19.0').extras).toEqual({ version: 'v5', features: [{ name: 'whatsapp_business_app_onboarding', enabled: false }] })
  })
})
