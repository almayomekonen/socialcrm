import type { Messages } from '../../../translate'

export const mobile: Messages['admin']['mobile'] = {
  users: {
    title: 'Users',
    invitations: 'Invitations',
    noUsers: 'There are no users in the workspace yet.',
    noInvitations: 'No pending invitations.',
    userFallback: 'User {id}',
    invitationFallback: 'Invitation {id}',
    user: 'User',
    suspended: 'Suspended',
    active: 'Active',
    role: 'Role',
    email: 'Email',
    phone: 'Phone',
    status: 'Status',
    desktopNote: 'Adding users and changing roles and permissions are available on a computer.',
  },
  autoResponse: {
    channelOff: 'The WhatsApp channel is off, so no messages are sent even while auto response is on. You can turn it on from a computer.',
    questionnaire: 'WhatsApp enquiries are currently answered by a fixed questionnaire set up for you, not by the message shown here. Turning auto response off stops the questionnaire too.',
    sent: 'The message that is sent',
    fixedNotSet: 'No fixed message has been set yet.',
    smartExplain: 'Each reply is written for the message that came in, so there is no fixed wording to show.',
    advanced: 'Advanced settings are available on a computer.',
    on: 'On · replies automatically on WhatsApp',
    off: 'Off · no auto response',
    forbidden: 'Only an admin can change auto response.',
    failed: "We couldn't update auto response. Try again.",
    proTitle: 'Auto response is available with Pro',
    proBody: 'Renewing your subscription brings back auto response.',
  },
  questionnaire: {
    draft: "There's an open draft that hasn't been published yet.",
    desktop: 'Editing the questionnaire and publishing a new version are available on a computer.',
    afterPublish: 'Once a questionnaire is published, you can test it here.',
  },
}
