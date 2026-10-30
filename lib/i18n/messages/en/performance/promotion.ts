import type { Messages } from '../../../translate'

export const promotion: Messages['performance']['promotion'] = {
  title: 'Campaigns',
  detailTitle: 'Campaign details',
  heading: 'Campaigns',
  empty: {
    title: 'No campaigns yet',
    line1: 'Campaigns are internal sales competitions between reps.',
    line2: 'The manager creates a campaign with goals and prizes, and you see your progress here.',
  },
  past: 'Past campaigns',
  notFound: 'Campaign not found',
  loadError: 'Error loading the campaign',
  noData: 'No data for this campaign yet',
  notIncluded: 'You are not part of this campaign',
  period: 'Campaign period: {start} - {end}',
  managerCampaign: 'Manager campaign',
  rules: 'Rules:',
  totalCommission: 'Total commission',
  deals: 'Deals',
  filterReps: 'Filter reps...',
  resetFilter: 'Reset filter',
  filterRepsButton: 'Filter reps',
  column: { rep: 'Rep', team: 'Team' },
}
