/**
 * A specific next step for each error Meta documents for Embedded Signup.
 * Error texts copied from
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/errors
 *
 * Meta's `error_id` is a per-report support id, not an error type, so the text
 * is the only key. When Meta localises it (e.g. Hebrew), nothing matches and the
 * general next step is used instead.
 */
import { describe, expect, it } from 'vitest'
import { metaSignupErrorNextStep } from '@/lib/connections/metaSignupErrorSteps'

const DOCUMENTED: [string, RegExp][] = [
  ['An error occurred while processing this request. Please try again later.', /תקלה זמנית/],
  ['You have reached the limit for the number of Businesses you can create at this time.', /תיק עסקי קיים/],
  ['Your Facebook account is too new to create a business account. Try again in an hour.', /חדש מדי/],
  [
    'There are limits on how often you can post, comment, or do other things in a given amount of time in order to help protect the community from spam. You can try again later.',
    /חשבון פייסבוק פעיל אחר/,
  ],
  [
    "You're no longer allowed to use Facebook Products to advertise. You can't run ads, manage advertising assets or create new ad or business accounts.",
    /חשבון פייסבוק פעיל אחר/,
  ],
  ['Your payment account is disabled', /חשבון פייסבוק פעיל אחר/],
  ['A User Can Only Create One Business User At One Time', /תיק עסקי קיים/],
  ["The name you chose for your business isn't valid. Consider using xxx.", /שם שתואם/],
  ['Cannot Edit Verified Name: Name verification already in progress.', /בבדיקה/],
  ['User does not have permission to create WhatsApp Business Accounts.', /הרשאת מנהל/],
  [
    'You can only create a limited number WhatsApp Business Accounts before your business and WhatsApp account verification is complete. You can create additional accounts after you are verified.',
    /חשבון WhatsApp עסקי קיים/,
  ],
  [
    "The Meta Business Account that you selected can't be verified. Go back to the previous screen to select a different account, or go to Meta Business Suite for support.",
    /תיק עסקי אחר/,
  ],
  ['Something has gone wrong. You will need to contact support and try again.', /תקלה זמנית/],
  [
    'Phone Number has been blocked. Please check alert prompt in WhatsApp Manager Overview or follow instructions in Business Support Home.',
    /חסום/,
  ],
  [
    'You have already linked the maximum number of phone numbers allowed for this Business Account. Delete a phone number to continue or request additional numbers.',
    /מכסת המספרים/,
  ],
  ['This phone number already exists in your list of phone numbers.', /לבחור אותו מהרשימה/],
  [
    'This number is registered to an existing WhatsApp account. To use this number, disconnect it from the existing account. Then, return to this page and re-enter the number. Note: It may take up to 3 minutes for the number to become available.',
    /WhatsApp Business/,
  ],
  ['Your verified name violates WhatsApp guidelines. Please edit your verified name and try again.', /שם שתואם/],
  ["Code couldn't be verified: You tried to register this number too many times. Try again later.", /12 שעות/],
  ["Your phone number doesn't appear to be valid. Please double check it, or try again after 5 minutes.", /5 דקות/],
  ['You have guessed too many times.', /12 שעות/],
  ['There was an error verifying this phone number. Please try again later.', /תקלה זמנית/],
  ['You have requested your code too many times.', /12 שעות/],
]

describe('metaSignupErrorNextStep', () => {
  it.each(DOCUMENTED)('%s', (message, expected) => {
    expect(metaSignupErrorNextStep(message)).toMatch(expected)
  })

  it('matches regardless of case and curly apostrophes', () => {
    expect(metaSignupErrorNextStep('YOUR PHONE NUMBER DOESN’T APPEAR TO BE VALID')).toMatch(/5 דקות/)
  })

  it('returns null for text it does not recognise, including a localised message', () => {
    expect(metaSignupErrorNextStep('ניחשת יותר מדי פעמים.')).toBeNull()
    expect(metaSignupErrorNextStep('')).toBeNull()
  })
})
