import type { Messages } from '../../../translate'

type M = Messages['mobileShell']

export const tabs: M['tabs'] = {
  more: 'More',
  badged: { one: '{tab}, {count} new', other: '{tab}, {count} new' },
}

export const header: M['header'] = {
  back: 'Back',
  lead: 'Lead',
}

export const more: M['more'] = {
  section: {
    profile: 'Profile',
    workspace: 'Workspace',
    business: 'Business',
    system: 'System',
    account: 'Account',
  },
  subtitle: {
    profile: 'Name, photo and preferences',
    repDetails: 'Your contact details',
    integrations: 'WhatsApp, Facebook and Instagram',
    teams: 'Group your reps into teams',
    users: 'Reps and invitations',
    business: 'Name, logo and contact details',
    billing: 'Plan, invoices and payments',
    autoResponse: 'Automatic WhatsApp replies',
    questionnaire: 'Questionnaire status and testing',
    security: 'Sign-in history and sign-out',
    system: 'Defaults',
    support: 'Open a request and follow it up',
  },
  desktop: {
    title: 'On the computer',
    body: 'Invoices, reports and automations are available in the desktop version.',
  },
  signedIn: 'Signed in',
}
