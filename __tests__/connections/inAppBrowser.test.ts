/**
 * In-app browser detection — asserted against REAL User-Agent strings, like
 * `deviceClass.test.ts`, because a regex tested only against our own examples
 * proves nothing about the browsers customers actually arrive in.
 *
 * The consequence of a miss is the production agency-149 failure: a signup from
 * an Instagram bio link tapping "connect" seven times into a Meta dialog that
 * never returns. The consequence of a false positive is one extra tap — the
 * warning is never a gate.
 */
import { describe, expect, it } from 'vitest'
import { inAppBrowserFromHeaders } from '@/lib/device'

const ua = (value?: string) => new Headers(value === undefined ? {} : { 'user-agent': value })

const INSTAGRAM_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.108 (iPhone15,2; iOS 17_5; he_IL; he; scale=3.00; 1179x2556; 614400392)'
const INSTAGRAM_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36 Instagram 334.0.0.42.95 Android (34/14; 480dpi; 1080x2340; samsung; SM-S918B; dm1q; qcom; iw_IL; 614400392)'
const FACEBOOK_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.108;FBBV/617213404;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/he_IL;FBOP/5;FBRV/619049424]'
const FACEBOOK_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240605.024; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/471.0.0.35.76;]'
const MESSENGER_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/466.0.0.39.109;FBBV/612345678;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5]'
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

describe('inAppBrowserFromHeaders', () => {
  it.each([
    ['Instagram on iOS', INSTAGRAM_IOS, 'instagram'],
    ['Instagram on Android', INSTAGRAM_ANDROID, 'instagram'],
    ['Facebook on iOS', FACEBOOK_IOS, 'facebook'],
    ['Facebook on Android', FACEBOOK_ANDROID, 'facebook'],
    ['Messenger on iOS', MESSENGER_IOS, 'facebook'],
  ])('%s → %s', (_label, value, expected) => {
    expect(inAppBrowserFromHeaders(ua(value))).toBe(expected)
  })

  it.each([
    ['Safari on iPhone', SAFARI_IPHONE],
    ['Chrome on Android', CHROME_ANDROID],
    ['Chrome on macOS', CHROME_MAC],
    ['an empty User-Agent', ''],
  ])('%s is not an in-app browser', (_label, value) => {
    expect(inAppBrowserFromHeaders(ua(value))).toBeNull()
  })

  it('a request with no User-Agent header is not an in-app browser', () => {
    expect(inAppBrowserFromHeaders(ua())).toBeNull()
  })
})
