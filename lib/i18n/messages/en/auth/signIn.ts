import type { Messages } from '../../../translate'

type A = Messages['auth']

export const signIn: A['signIn'] = {
  title: 'Sign in | SocialCRM — lead management',
  heading: 'Welcome back',
  subtitle: 'Welcome back. Enter your details to continue',
  worksWith: 'Works with WhatsApp, Instagram and Facebook',
  noAccount: "Don't have an account?",
  join: 'Join now',
  imageAlt: 'Lead management for small businesses',
}

export const magic: A['magic'] = {
  email: 'Email',
  remember: 'Remember me',
  resend: 'Resend link',
  submit: 'Start for free',
  submitting: 'Loading...',
  sent: 'A sign-in link was sent to your email',
  linkInvalid: 'The link is invalid or has expired',
  network: 'A network error occurred. Please try again.',
}

export const wait: A['wait'] = {
  slow: 'This is taking longer than usual...',
  timeout: 'This is taking much longer than usual. Please try again.',
}

export const social: A['social'] = {
  signedInAs: 'Signing in as {name}',
  google: 'Sign in with Google',
  facebook: 'Sign in with Facebook',
  failed: 'Sign-in failed. Please try again.',
}

export const register: A['register'] = {
  title: 'Sign up',
  heading: 'Welcome',
  subtitle: 'Join now and start managing your leads in a few steps',
  businessName: 'Business name',
  firstName: 'First name',
  lastName: 'Last name',
  terms: 'I agree to the Terms of Use',
  termsLink: 'Terms of Use',
  submit: 'Create account',
  haveAccount: 'Already have an account?',
  signIn: 'Sign in',
}

export const server: A['server'] = {
  suspended: 'This user is suspended',
  facebookNoEmail: 'Facebook did not return an email address. You can sign in with Google or with email.',
  facebookTaken: 'This Facebook account is already connected. Sign in with Facebook.',
  facebookUnavailable: 'Sign-in with Facebook is not available for this account',
  sendFailed: 'The sign-in link could not be sent. Please try again in a moment.',
  emailInvalid: 'The email address is not valid. Check that it is written in full, for example name@gmail.com',
  emailTaken: 'This email address is already registered',
  generic: 'An error occurred. Please try again.',
}
