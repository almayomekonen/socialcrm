/**
 * Leads namespace — composed from one file per surface, each under the
 * 250-line soft limit. Phase B keys (`add`, `outcome`, `contact`) are unchanged;
 * Phase C adds the /leads and /clients list surfaces. Hebrew copied verbatim.
 */
import { base } from './base'
import { status, statusForm, table, toolbar, action } from './table'
import { dialog, deleteError, deleteResult, assignResult } from './dialogs'
import { empty, page } from './empty'
import { firstRun } from './firstRun'
import { banners, intake, quota } from './banners'
import { form, duplicate, assign, transfer, list, upload } from './forms'

export const leads = {
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
} as const
