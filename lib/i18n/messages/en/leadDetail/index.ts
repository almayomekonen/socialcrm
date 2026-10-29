import type { Messages } from '../../../translate'
import { page, header, nav } from './header'
import { summary, outcome, followUp, firstLead, tasks, activity, readyMessage } from './summary'
import { inbound, formField, ad } from './inbound'
import { intelligence } from './intelligence'

export const leadDetail: Messages['leadDetail'] = {
  page,
  header,
  nav,
  summary,
  outcome,
  followUp,
  firstLead,
  tasks,
  activity,
  readyMessage,
  inbound,
  formField,
  ad,
  intelligence,
}
