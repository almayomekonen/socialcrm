import type { Messages } from '../../../translate'
import { base } from './base'
import { status, statusForm, table, toolbar, action } from './table'
import { dialog, deleteError, deleteResult, assignResult } from './dialogs'
import { empty, page } from './empty'
import { firstRun } from './firstRun'
import { banners, intake, quota } from './banners'
import { form, duplicate, assign, transfer, list, upload } from './forms'

export const leads: Messages['leads'] = {
  ...base,
  status,
  statusForm,
  table,
  toolbar,
  action,
  dialog,
  deleteError,
  deleteResult,
  assignResult,
  empty,
  page,
  firstRun,
  banners,
  intake,
  quota,
  form,
  duplicate,
  assign,
  transfer,
  list,
  upload,
}
