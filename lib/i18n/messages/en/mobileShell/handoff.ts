import type { Messages } from '../../../translate'

export const desktopOnly: Messages['mobileShell']['desktopOnly'] = {
  title: {
    clients: 'Leads that closed a deal',
    leadTasks: 'Lead tasks',
    leadFiles: 'Lead files',
    leadBilling: 'Lead billing',
    aiInspector: 'AI Inspector',
  },
  body: {
    tasks: 'This screen is currently available on the computer. There you see every task, filter by rep and mark what is already done.',
    calendar: 'This screen is currently available on the computer. There you connect Google Calendar and see every upcoming meeting.',
    deals: 'This screen is currently available on the computer. There you manage deals and see their amounts and progress.',
    clients: 'This screen is currently available on the computer. There you see every lead that already closed a deal, with all of their details.',
    sumSales: "This screen is currently available on the computer. There you see sales summaries, goals and each rep's performance.",
    files: 'This screen is currently available on the computer. There you see every file attached to leads and tasks.',
    promotion: 'This screen is currently available on the computer. There you see sales competitions, goals and your progress toward them.',
    leadTasks: 'This screen is currently available on the computer. There you see every task opened for this lead and add a new one.',
    leadFiles: 'This screen is currently available on the computer. There you see the files attached to this lead and attach files from Google Drive.',
    leadBilling: 'This screen is currently available on the computer. There you issue quotes and invoices for this lead and follow their status.',
    aiInspector: "This screen is currently available on the computer. There you see the history of the AI's decisions and the data they were based on.",
  },
  fullScreen: 'The full screen is available on the computer',
  copy: {
    label: 'Copy the sign-in link for your computer',
    copied: 'Link copied',
    failed: "We couldn't copy it. You can select the address and copy it by hand.",
  },
}
