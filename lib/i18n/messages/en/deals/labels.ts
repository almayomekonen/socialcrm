import type { Messages } from '../../../translate'

type D = Messages['deals']

export const status: D['status'] = {
  new: 'New',
  proposal: 'Proposal sent',
  negotiating: 'Negotiating',
  awaitingPayment: 'Awaiting payment',
  paid: 'Paid',
  cancelled: 'Cancelled',
  all: 'All',
}

export const branch: D['branch'] = {
  total: 'Weighted total',
  services: 'Services',
  products: 'Products',
  courses: 'Courses',
  subscriptions: 'Subscriptions',
  packages: 'Packages',
  consulting: 'Consulting',
  others: 'Other',
}

export const company: D['company'] = { none: 'No supplier', others: 'Other' }

export const productType: D['productType'] = { transfer: 'Transfer', monthly: 'Monthly payment', oneTime: 'One-time payment' }

export const product: D['product'] = {
  socialMedia: 'Social media management',
  website: 'Website build',
  seo: 'SEO',
  ppc: 'PPC',
  content: 'Marketing content',
  physical: 'Physical product',
  digital: 'Digital product',
  software: 'Software',
  onlineCourse: 'Online course',
  workshop: 'Workshop',
  coaching: 'Personal coaching',
  monthlySub: 'Monthly subscription',
  yearlySub: 'Annual subscription',
  basicPackage: 'Basic package',
  advancedPackage: 'Advanced package',
  premiumPackage: 'Premium package',
  businessConsulting: 'Business consulting',
  marketingConsulting: 'Marketing consulting',
  strategyConsulting: 'Strategy consulting',
  others: 'Other',
}

export const action: D['action'] = { sale: 'Sale', join: 'Sign-up', all: 'All' }

export const dateRange: D['dateRange'] = {
  all: 'All dates',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  thisWeek: 'This week',
  lastWeek: 'Last week',
  thisYear: 'This year',
  lastYear: 'Last year',
  custom: 'Custom',
}

export const leadSource: D['leadSource'] = { website: 'Website', referral: 'Referral', paid: 'Paid ads', organic: 'Organic' }
