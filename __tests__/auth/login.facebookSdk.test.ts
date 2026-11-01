import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

describe('Facebook User Login button', () => {
  const src = readFileSync(new URL('../../components/auth/Login.tsx', import.meta.url), 'utf8')

  it('requests public_profile,email and keeps a synchronous FB.login callback', () => {
    expect(src).toContain("{ scope: 'public_profile,email' }")
    expect(src).toContain('void handleFacebookResponse(response)')
    expect(src).not.toMatch(/FB\.login\(\s*async/)
  })
})

describe('Facebook account linking button', () => {
  const src = readFileSync(
    new URL('../../components/settings/security/ConnectFacebookAccount.tsx', import.meta.url),
    'utf8',
  )

  it('sends only the access token and keeps a synchronous FB.login callback', () => {
    expect(src).toContain("{ scope: 'public_profile,email' }")
    expect(src).toContain('void handleFacebookResponse(response)')
    expect(src).not.toMatch(/\.login\(\s*async/)
    expect(src).toContain('linkFacebookAccount({ accessToken: response.authResponse.accessToken })')
    expect(src).not.toContain('facebookSub:')
    expect(src).not.toContain('userId:')
    expect(src).not.toContain('META_APP_ID')
  })
})

describe('Google authentication is unchanged', () => {
  const src = readFileSync(new URL('../../actions/auth.ts', import.meta.url), 'utf8')

  it('checkUser still verifies only a Google credential', () => {
    expect(src).toContain('export async function checkUser(input: { credential?: string })')
    expect(src).toContain('verifyGoogleCredential(input?.credential)')
    expect(src).toContain("route=google_check")
    expect(src).toContain('gglSub: verified.sub')
  })
})

describe('auth pages use the authentication App ID', () => {
  const loginPage = readFileSync(new URL('../../app/(he)/(auth)/auth/page.tsx', import.meta.url), 'utf8')
  const registerPage = readFileSync(new URL('../../app/(he)/(auth)/auth/register/page.tsx', import.meta.url), 'utf8')

  it('gates the Facebook SDK App ID behind the server-side rollout helpers', () => {
    expect(loginPage).toContain('process.env.AUTH_FACEBOOK_APP_ID')
    expect(loginPage).not.toContain('process.env.META_APP_ID')
    expect(loginPage).toContain('canUseFacebookUserAuth')
    expect(loginPage).toContain('isFacebookUserAuthPubliclyAvailable')
    expect(registerPage).toContain('process.env.AUTH_FACEBOOK_APP_ID')
    expect(registerPage).not.toContain('process.env.META_APP_ID')
    expect(registerPage).toContain('isFacebookUserAuthOpenToNewAgencies')
    const securityPage = readFileSync(
      new URL('../../app/(he)/(app)/settings/(user_settings)/update_security/page.tsx', import.meta.url),
      'utf8',
    )
    expect(securityPage).toContain('process.env.AUTH_FACEBOOK_APP_ID')
    expect(securityPage).not.toContain('META_APP_ID')
    expect(securityPage).toContain('canUseFacebookUserAuth')
  })
})

describe('business Meta integration stays on META_APP_ID', () => {
  it('Page Connect and WhatsApp Embedded Signup still use the business app', () => {
    const pageOAuth = readFileSync(new URL('../../app/api/auth/facebook/route.ts', import.meta.url), 'utf8')
    const waSignup = readFileSync(new URL('../../lib/facebook/useEmbeddedSignup.ts', import.meta.url), 'utf8')
    const leadSources = readFileSync(
      new URL('../../components/settings/integrations/LeadSourcesSection.tsx', import.meta.url),
      'utf8',
    )
    expect(pageOAuth).toContain('process.env.META_APP_ID')
    expect(pageOAuth).not.toContain('AUTH_FACEBOOK_APP_ID')
    expect(waSignup).toContain('config_id: configId')
    expect(leadSources).toContain('process.env.META_APP_ID')
    expect(leadSources).not.toContain('AUTH_FACEBOOK_APP_ID')
  })

  it('launches Embedded Signup through embeddedSignupLaunch; the default build is v4 with featureType, no setup or sessionInfoVersion', async () => {
    const waSignup = readFileSync(new URL('../../lib/facebook/useEmbeddedSignup.ts', import.meta.url), 'utf8')
    expect(waSignup).toContain('config_id: configId')
    expect(waSignup).toContain("response_type: 'code'")
    expect(waSignup).toContain('override_default_response_type: true')
    expect(waSignup).toContain('extras: launchParams.extras')
    expect(waSignup).toContain('initFacebookApp(appId, launchParams.sdkVersion)')
    expect(waSignup).not.toContain('sessionInfoVersion')
    expect(waSignup).toContain('createEmbeddedSignupGate')
    expect(waSignup).toContain('gate.acceptCode(code)')
    expect(waSignup).not.toContain('esDataRef')
    const { embeddedSignupLaunch } = await import('@/lib/facebook/embeddedSignupLaunch')
    expect(embeddedSignupLaunch('v19.0')).toEqual({
      extras: { version: 'v4', featureType: 'whatsapp_business_app_onboarding' },
      sdkVersion: 'v19.0',
    })
  })
})
