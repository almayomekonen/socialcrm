import type { Messages } from '../../../translate'

type L = Messages['leadDetail']

export const page: L['page'] = {
  title: 'Lead details',
  description: 'All of the lead’s details',
  notFound: 'This lead was not found',
}

export const header: L['header'] = {
  handler: 'Lead owner:',
  copied: '{text} copied to clipboard',
  closeDeal: 'Close deal',
}

export const nav: L['nav'] = {
  summary: 'Lead summary',
  tasks: 'Tasks',
  files: 'Files',
  billing: 'Billing',
}
