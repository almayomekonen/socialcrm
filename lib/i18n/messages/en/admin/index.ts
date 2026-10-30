import type { Messages } from '../../../translate'
import { users, invitations, teams } from './users'
import { promos, taskTmplts } from './promos'
import { quotes } from './quotes'
import { autoResponse } from './autoResponse'

const page: Messages['admin']['page'] = { denied: "You don't have permission to view this page", title: { group: 'Admin settings' } }

export const admin: Messages['admin'] = { page, users, invitations, teams, promos, taskTmplts, quotes, autoResponse }
