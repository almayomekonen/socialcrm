import type { Messages } from '../../../translate'

type L = Messages['education']

export const chrome: L['chrome'] = {
  progress: '{current} of {total}',
  next: 'Next',
  prev: 'Back',
  done: 'Got it',
  skip: 'Skip',
  fallbackLabel: 'Guided tour',
}

export const intro: L['intro'] = {
  title: 'Welcome to SocialCRM',
  description: 'Would you like a short tour of the system?',
  start: 'Start the tour',
  later: 'Maybe later',
}

export const help: L['help'] = {
  body: 'A short tour, guides, or report a problem.',
  overview: 'Show me how the system works',
  pipeline: 'Leads tour',
  guides: 'Guides',
  problem: 'I have a problem',
  copilotHint: '⌘ + J  Smart assistant',
}

export const leadsEmpty: L['leadsEmpty'] = {
  title: 'No leads yet',
  body: 'To start the leads tour, add at least one lead.',
  dismiss: 'Got it',
}
