/**
 * Lead detail namespace (Phase C) — `/clients/[clientId]` layout + summary,
 * composed from one file per surface. Hebrew copied verbatim.
 */
import { page, header, nav } from './header'
import { summary, outcome, followUp, firstLead, tasks, activity, readyMessage } from './summary'
import { inbound, formField, ad } from './inbound'
import { intelligence } from './intelligence'

export const leadDetail = {
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
} as const
