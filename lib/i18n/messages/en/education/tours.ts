import type { Messages } from '../../../translate'

/** "מעקב" in the lead tour is the follow-up control: "Follow-up". */
export const tours: Messages['education']['tours'] = {
  overview: {
    today: { title: 'Today', description: 'See what needs your attention right now.' },
    leads: { title: 'Leads', description: 'All your leads, from every channel, in one place.' },
    clients: { title: 'Customers', description: 'Closed leads — keep managing them from here.' },
    inbox: { title: 'Conversations', description: 'Manage your conversations with leads here.' },
    deals: { title: 'Deals', description: 'Follow the deals in progress here.' },
    performance: { title: 'Performance', description: 'See how the work is progressing.' },
    tasks: { title: 'Tasks', description: 'See what still needs to be done.' },
    calendar: { title: 'Meetings', description: 'See your upcoming meetings.' },
    settings: { title: 'Settings', description: 'Connect WhatsApp, Facebook and more here.' },
    header: { title: 'The top bar', description: 'The actions and tools available to you from anywhere in the system.' },
    copilot: {
      title: 'Smart assistant',
      description: 'Need help? Ask the smart assistant and it will help you understand what to do and how to move forward.',
    },
    notifications: { title: 'Notifications', description: 'Things that need your attention show up here.' },
    end: { title: "That's it, you're all set", description: 'You know the main areas of SocialCRM. You can start working from here.' },
  },
  pipeline: {
    table: { title: 'The list', description: 'All your leads, from every channel — this is where the daily work starts.' },
    statuses: { title: 'Statuses', description: 'The status tells you who is new, who is in progress and who needs your attention.' },
    open: {
      title: 'Opening a lead',
      description: 'Found a lead to work on? Open it to see the details, get in touch and update the next action.',
    },
    add: { title: 'New lead', description: 'Add leads by hand, import them, or receive them from the channels connected to SocialCRM.' },
    end: { title: "That's the whole idea", description: 'Find a lead → open it → work on it → move on to the next lead.' },
  },
  lead: {
    status: { title: 'Lead status', description: 'Update it after a call so nothing slips through.' },
    followUp: { title: 'Follow-up', description: 'Set when to get back to them — the system reminds you on time.' },
  },
  copilot: {
    trigger: { title: 'Smart assistant', description: 'Ask who needs you right now. It never sends messages without your approval.' },
  },
  whatsapp: {
    section: { title: 'WhatsApp', description: 'Connect WhatsApp here, in Settings → Integrations.' },
    connect: { title: 'Connect', description: 'Start connecting WhatsApp with this button.' },
  },
  facebook: {
    section: { title: 'Facebook', description: 'Connect Facebook here, in Settings → Integrations.' },
    connect: { title: 'Connect', description: 'Start connecting Facebook with this button.' },
  },
}
