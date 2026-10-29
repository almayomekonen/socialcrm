import type { Messages } from '../../../translate'

type P = Messages['performance']

export const page: P['page'] = {
  title: 'Performance',
  description: 'Deal performance',
  monthsTitle: 'Deals by month',
  monthsDescription: 'Rep deal summary by month',
  companiesTitle: 'Deals by supplier',
  companiesDescription: 'Rep deal summary by supplier',
  agentsDenied: 'Not allowed',
  teamsDenied: 'You do not have permission to view the team summary',
}

export const nav: P['nav'] = { summary: 'Summary', reps: 'Reps', months: 'Months', ads: 'Ads' }

export const overview: P['overview'] = {
  revenuePaid: 'Total revenue (paid)',
  closedDeals: 'Closed deals',
  pipeline: 'Pipeline',
  inProgress: 'Deals in progress',
  compare: 'Deal comparison',
  pieCommission: 'Commission',
  pieIncome: 'Income',
  pieDeals: 'Deals',
  total: 'Total',
  annualPace: 'Annual pace',
  goals: {
    categories: 'Categories',
    monthDeals: 'Deals this month',
    monthlyGoal: 'Monthly goal',
    progress: 'Goal reached',
    annualPace: 'Annual pace',
  },
}

export const report: P['report'] = {
  empty: 'No data to show',
  column: { rep: 'Rep', month: 'Month', team: 'Team', company: 'Company' },
}
