import type { Messages } from '../../../translate'
import { users, invitations, teams } from './users'
import { promos, taskTmplts } from './promos'
import { quotes } from './quotes'
import { autoResponse } from './autoResponse'

const page: Messages['admin']['page'] = { denied: 'ليست لديك صلاحية لعرض هذه الصفحة', title: { group: 'إعدادات المسؤول' } }

export const admin: Messages['admin'] = { page, users, invitations, teams, promos, taskTmplts, quotes, autoResponse }
