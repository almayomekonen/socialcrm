import type { Messages } from '../../../translate'

type L = Messages['leads']

export const form: L['form'] = {
  addTitle: 'Add lead',
  editTitle: 'Edit lead',
  owner: 'Lead owner',
  firstName: 'First name',
  lastName: 'Last name',
  gender: 'Gender',
  phone: 'Mobile phone',
  email: 'Email',
  birthDate: 'Date of birth',
  leadSource: 'Lead source',
  handler: 'Additional owner (optional)',
  status: 'Status',
  kindLead: 'Lead',
  moreInfo: 'More details',
  idNum: 'ID number',
  secPhone: 'Second phone',
  idNumTaken: 'This ID number already belongs to the lead {name}',
  idNumInvalid: 'Invalid ID number',
  genderOption: { male: 'Male', female: 'Female' },
  sourceOption: {
    manual: 'Manual',
    website: 'Website',
    referral: 'Referral',
    import: 'Import',
    misc: 'Other',
  },
}

export const duplicate: L['duplicate'] = {
  strong: 'This lead may already exist',
  soft: 'A similar lead was found',
  hide: 'Hide',
  unnamed: 'Unnamed lead',
  hint: "If it's the same lead, you can cancel and update the existing one. Otherwise, continue and save.",
  signal: { idNum: 'Same ID number', phone: 'Same phone number', email: 'Same email address' },
}

export const assign: L['assign'] = {
  titleMany: { one: 'Assign {count} lead to a rep', other: 'Assign {count} leads to a rep' },
  pickRep: 'Choose a rep',
  submit: 'Assign to rep',
  cancel: 'Cancel',
  confirmOne: 'Assign the lead to {rep}?',
  confirmMany: { one: 'Assign {count} lead to {rep}?', other: 'Assign {count} leads to {rep}?' },
}

export const transfer: L['transfer'] = {
  title: 'Transfer lead from owner {owner}',
  pickOwner: 'Choose a new lead owner',
  confirm: 'Transfer the lead {name} to owner {owner}?',
}

export const list: L['list'] = {
  editTitle: 'Edit list',
  newTitle: 'Create a new list',
  delete: 'Delete list',
  name: 'List name',
  search: 'Search',
  pickLeads: 'Choose leads',
  pickRequired: 'Choose at least one lead',
}

export const upload: L['upload'] = {
  proTitle: 'Importing leads is available with Pro',
  proBody: 'Renewing your subscription brings back importing leads from a file.',
  method: 'Import method',
  fileTypes: 'Excel or CSV file (xlsx, xls, csv)',
  fileHint: 'First row: first name, phone — and optionally last name, email, ID number.',
  excelButton: 'Upload Excel file',
  saved: 'Leads saved',
  imported: { one: '{count} lead imported', other: '{count} leads imported' },
  viewYourLeads: 'View your leads',
  invalid: 'Invalid data, not saved',
  csvTitle: 'Import leads from a CSV file',
  csvHint: 'Required columns: name, phone, email (at least a phone or an email)',
  processing: 'Processing...',
  csvButton: 'Upload CSV file',
  allExist: 'All these leads are already in the system',
  alreadyUploaded: 'It looks like this file was uploaded before',
  addedNew: { one: '{count} new lead added', other: '{count} new leads added' },
  unchanged: { one: '{count} lead already exists and was not changed', other: '{count} leads already exist and were not changed' },
  allAdded: 'All leads were added',
  noneAdded: 'No leads were added',
  checkColumns: 'Check that the file has a phone or email column',
  updated: { one: 'Updated details for {count} existing lead', other: 'Updated details for {count} existing leads' },
  invalidRows: 'Invalid rows: {n}',
  viewLeads: 'View leads',
}
