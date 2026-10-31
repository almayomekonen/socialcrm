import type { Messages } from '../../../translate'

type A = Messages['auth']

/** No emoji outside Hebrew (CLAUDE.md §12); the Hebrew heading keeps its existing one. */
export const activation: A['activation'] = {
  dialog: 'SocialCRM activation',
  video: 'SocialCRM explainer video',
  ready: {
    heading: 'Your workspace is ready',
    connected: 'Your Meta account was connected successfully.',
    moving: 'Taking you to the system...',
  },
  step: 'Step 2 of 2',
  done: 'Done',
  waiting: { heading: 'Once this step is done, every new lead will arrive here automatically.' },
  start: 'Start receiving leads',
  connecting: 'Connecting…',
  linking: 'Linking…',
  trust: { secure: 'Secure connection through Meta', ownLeads: 'Access to your leads only', yourData: 'Your data stays yours' },
  finishing: 'Finishing the connection…',
  select: { heading: 'Which Page should we connect?' },
  subscribing: 'Connecting your lead source…',
  completed: {
    heading: 'Your workspace is ready.',
    body: 'From now on, every new lead will arrive here automatically.',
    instruction: 'Continue on your computer for the full experience.',
    secondary: 'Already at your computer? Go to getsocialcrm.com',
  },
  failed: { heading: 'The connection was not completed.', body: 'You can try again to receive leads automatically.' },
  retry: 'Try again',
}

export const handoff: A['handoff'] = {
  heading: 'SocialCRM works best on a computer.',
  body: 'The system is built for a large screen, to manage leads, conversations and AI in one place.',
  share: 'Share the link',
  shareText: 'Sign in to SocialCRM',
  soon: 'Mobile app — in development',
  support: 'Need help? Talk to us',
}
