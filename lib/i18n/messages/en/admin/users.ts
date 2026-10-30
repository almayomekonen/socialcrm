import type { Messages } from '../../../translate'

export const users: Messages['admin']['users'] = {
  title: 'Edit users',
  invitationsTitle: 'Invitations',
  allRoles: 'All roles',
  role: { AGNT: 'Sales rep', MNGR: 'Manager', OFFICE: 'Operations', ADMIN: 'Admin', GM: 'General manager', EXT: 'External partner' },
  col: {
    name: 'Name',
    role: 'Role',
    email: 'Email',
    phone: 'Phone',
    suspended: 'Suspended',
    gavePerm: 'Permissions given',
    gotPerm: 'Permissions received',
    updatedAt: 'Updated on',
    createdAt: 'Created on',
    id: 'ID',
    edit: 'Edit',
  },
  editRep: 'Edit rep',
  edit: {
    newUser: 'Add user',
    transfer: 'Transfer deals to another rep',
    deleteRep: 'Delete rep',
    personal: 'Personal details',
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email',
    emailTitle: 'Enter a valid email address (for example, user@example.com)',
    phone: 'Phone number',
    role: 'Role',
    suspended: 'Account suspended',
    perms: 'Permissions',
    reps: 'Reps',
    save: 'Save details',
    officeRefused: "The rep can't be changed to operations because they have deals. Transfer the deals to another rep and try again.",
    deleteRefused: `{name} wasn't deleted because there are deals in their name.
Delete the deals
or transfer them to another rep
and try again`,
    deleteLinked: "The rep can't be deleted because leads are linked to them",
    deleteConfirm: 'Delete {name}?',
  },
}

export const invitations: Messages['admin']['invitations'] = {
  col: {
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email',
    role: 'Role',
    phone: 'Phone',
    createdAt: 'Created on',
    expiresAt: 'Expiry date',
    status: 'Status',
    delete: 'Delete',
  },
  deleteLabel: 'Delete invitation',
  invite: 'Invite user',
  deleteConfirm: 'Delete the invitation?',
  expired: 'Expired',
  pending: 'Awaiting acceptance',
  genericError: 'Something went wrong. Try again.',
  existing: "This user is already in the system, so no invitation is needed. To make them a rep, change their role in the users table above.",
  form: { title: 'New user', firstName: 'First name', lastName: 'Last name', email: 'Email', phone: 'Phone', role: 'Role', send: 'Send invitation' },
  server: {
    forbidden: 'No permission',
    badRole: 'Invalid role',
    sendFailed: "The invitation couldn't be sent. Try again.",
    createFailed: 'Something went wrong while creating the invitation.',
  },
}

export const teams: Messages['admin']['teams'] = {
  title: 'Edit teams',
  add: 'Add team',
  empty: 'No teams yet',
  edit: 'Edit team',
  delete: 'Delete team',
  mngrs: 'Managers',
  repsCount: 'Reps ({count})',
  offices: 'Operations staff',
  deleteConfirm: 'Delete the team {name}?',
  form: { name: 'Team name', mngrs: 'Managers', reps: 'Reps', offices: 'Operations staff', noReps: 'Select reps', mngrIsRep: "A manager can't also be a rep" },
}
