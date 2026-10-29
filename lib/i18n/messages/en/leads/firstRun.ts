import type { Messages } from '../../../translate'

export const firstRun: Messages['leads']['firstRun'] = {
  headline: "Your workspace is open — now let's bring in your leads",
  subhead:
    'SocialCRM brings your leads from WhatsApp and from Facebook and Instagram ads into one list, with a status and tracking for every lead.',
  connect: {
    heading: 'Connect the source your leads come from',
    rationale: 'Once connected, every new inquiry lands here automatically — no copying by hand.',
    recommendedBadge: 'Recommended',
    whatsapp: { title: 'WhatsApp', description: 'Every incoming message opens as a lead, and the conversation is kept here' },
    meta: { title: 'Facebook & Instagram', description: 'Leads from your ads arrive automatically' },
  },
  own: {
    heading: 'Bring in the leads you already have',
    rationale: "Within a minute you'll see one list of everyone you need to get back to.",
    recommendedBadge: 'Fastest',
    import: { title: 'Your list, organized', description: 'An Excel file, or just paste phone numbers' },
    add: { title: 'Add a single lead', description: "By hand, when there's no list to import" },
  },
  paste: {
    tabFile: 'File',
    tabPaste: 'Paste numbers',
    label: 'Paste phone numbers, one per line',
    placeholder: '0521234567\nDana Levi, 0537654321',
    hint: 'You can also use "name, phone" on each line.',
    submit: { one: 'Add 1 lead', other: 'Add {count} leads' },
    submitEmpty: 'Add leads',
    pending: 'Adding…',
    skipped: { one: "1 line couldn't be read and won't be added", other: "{count} lines couldn't be read and won't be added" },
    truncated: 'The first 1000 lines were added. You can paste the rest afterwards.',
    empty: "We didn't find any phone numbers in the pasted text.",
    failed: "We couldn't add the leads. Please try again.",
    quota: "You've reached your lead limit ({limit}). The list wasn't added.",
  },
  connected: {
    headline: 'No leads yet',
    subhead: 'Your Meta account is connected. Your first lead will appear here automatically as soon as it arrives.',
  },
  statusConnected: 'Connected',
  firstImport: {
    title: { one: 'Your lead is in', other: '{count} leads are in' },
    body: 'Next step: open the first one and set when to get back to it.',
    skipped: {
      one: "1 line in the file couldn't be read and wasn't added",
      other: "{count} lines in the file couldn't be read and weren't added",
    },
    cta: 'Open the first lead',
    dismiss: 'Close',
  },
}
