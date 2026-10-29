import type { Messages } from '../../../translate'

type L = Messages['leadDetail']

export const intelligence: L['intelligence'] = {
  title: 'Smart summary',
  unavailable: 'The smart assistant isn’t available right now. Try again in a minute.',
  confidence: { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' },
  nextAction: 'Recommended action',
  basedOn: 'Based on: {sources}',
  source: {
    status: 'Lead status',
    activity: 'Recent activity',
    tasks: 'Task history',
    details: 'Lead details',
    origin: 'Lead source',
    handling: 'Lead handling',
  },
  skeleton: {
    analyzing: 'Analyzing…',
    loading: 'Loading smart insights for this lead',
    step1: 'Analyzing the lead’s history…',
    step2: 'Checking recent activity and tasks…',
    step3: 'Spotting patterns and opportunities…',
    step4: 'Reviewing engagement and risk…',
    step5: 'Preparing tailored insights…',
  },
  teaser: {
    label: 'Smart summary, available with Pro',
    body: 'The smart summary analyzes the lead and suggests the next step.',
    cta: 'View the summary',
    proTitle: 'The smart summary is available with Pro',
    proBody: 'Renewing your subscription brings back the smart summary.',
  },
  refresh: {
    action: 'Refresh insights',
    pending: 'Refreshing…',
    rateLimited: 'Try again in a minute',
    failed: 'Can’t refresh right now',
  },
}
