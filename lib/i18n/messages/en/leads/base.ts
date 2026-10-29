import type { Messages } from '../../../translate'

export const base: Pick<Messages['leads'], 'add' | 'outcome' | 'contact'> = {
  add: 'Add lead',
  outcome: {
    noAnswer: 'No answer',
    reached: 'We talked',
    interested: 'Interested',
    notInterested: 'Not interested',
    title: 'Call outcome',
    titleLabel: 'Call outcome:',
    logAria: 'Log call outcome',
    toast: {
      noAnswerOn: "You couldn't reach the lead. We'll remind you to try again on {date}.",
      noAnswer: "You couldn't reach the lead. We set a reminder to try again.",
      reachedOn: 'Call saved. The lead returns to your follow-up list on {date}.',
      reached: 'Call saved.',
      interestedOn: "Lead marked as interested. We'll bring it back for follow-up on {date} to move toward closing.",
      interested: 'Lead marked as interested.',
      notInterested: 'Lead marked as not relevant and removed from your follow-up list.',
    },
  },
  contact: {
    call: 'Call',
    callName: 'Call {name}',
    whatsapp: 'WhatsApp',
    whatsappName: 'WhatsApp {name}',
    opening: 'Opening…',
    noValidPhone: "This lead doesn't have a valid WhatsApp phone number",
  },
}
