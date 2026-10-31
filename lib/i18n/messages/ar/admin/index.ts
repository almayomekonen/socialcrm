import type { Messages } from '../../../translate'
import { users, invitations, teams } from './users'
import { promos, taskTmplts } from './promos'
import { quotes } from './quotes'
import { autoResponse } from './autoResponse'
import { automations } from './automations'
import { automationSheet } from './automationSheet'
import { automationCatalog } from './automationCatalog'
import { automationTemplates } from './automationTemplates'
import { connections } from './connections'
import { questionnaire } from './questionnaire'
import { questionnaireFlow } from './questionnaireFlow'
import { questionnaireCopy } from './questionnaireCopy'
import { mobile } from './mobile'

const page: Messages['admin']['page'] = { denied: 'ليست لديك صلاحية لعرض هذه الصفحة', title: { group: 'إعدادات المسؤول' } }

export const admin: Messages['admin'] = { page, users, invitations, teams, promos, taskTmplts, quotes, autoResponse, automations, automationSheet, automationCatalog, automationTemplates, connections, questionnaire, questionnaireFlow, questionnaireCopy, mobile }
