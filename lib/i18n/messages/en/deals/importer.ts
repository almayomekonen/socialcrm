import type { Messages } from '../../../translate'

export const importer: Messages['deals']['importer'] = {
  proTitle: 'Importing deals is available with Pro',
  proBody: 'Renewing your subscription brings back importing deals from a file.',
  unreadable: 'We could not read the file. Make sure it is a valid Excel file and try again.',
  failed: 'The deal import failed. No deals were saved — try again.',
  confirm: { one: 'Found {count} valid deal. Import it?', other: 'Found {count} valid deals. Import the deals?' },
  confirmWithWrong: {
    one: 'Found {count} valid deal. Invalid rows that will not be imported: {wrong}. Import it?',
    other: 'Found {count} valid deals. Invalid rows that will not be imported: {wrong}. Import the deals?',
  },
  confirmButton: 'Import deals',
  fileTitle: 'Excel file (xlsx, xls)',
  fileHint: 'First row: amount, phone or email — and optionally name, status, deal date, deal name, notes.',
  processing: 'Processing...',
  choose: 'Choose an Excel file',
  chooseLabel: 'Choose a deals file',
  imported: { one: '{count} deal imported', other: '{count} deals imported' },
  none: 'No deals were imported',
  createdLeads: { one: '{count} new lead created', other: '{count} new leads created' },
  duplicates: { one: 'Skipped {count} deal that already exists', other: 'Skipped {count} deals that already exist' },
  rejectedCount: 'Rows not imported: {count}',
  rejectedTitle: 'Rows not imported',
  rejectedRow: 'Row {row}: {reason}',
}
