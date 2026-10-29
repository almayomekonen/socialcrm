import { vi } from 'vitest'
import { globalEnv } from './globalTasksFilesEnv'
import { GAVE_PERM_USERS, GOT_PERM_USERS } from './globalTasksFilesEnv'

/**
 * Shared spies + module factories behind the global /tasks and /files locale
 * and behaviour tests (Phase E1). The `vi.mock` calls live in each test file
 * (hoisted per file); they delegate to these factories.
 */
export const gSpies = {
  prefs: { userLocale: 'en' as string | null },
  toasts: [] as unknown[][],
  redirects: [] as string[],
  pushes: [] as string[],
  addTask: vi.fn(async (..._a: unknown[]) => 99),
  addTaskFromTmplt: vi.fn(async (..._a: unknown[]) => 98),
  deleteFile: vi.fn(async (..._a: unknown[]) => {}),
  saveTblPref: vi.fn(async (..._a: unknown[]) => ({})),
}

export function resetGSpies() {
  gSpies.toasts.length = 0
  gSpies.redirects.length = 0
  gSpies.pushes.length = 0
  for (const fn of [gSpies.addTask, gSpies.addTaskFromTmplt, gSpies.deleteFile, gSpies.saveTblPref]) fn.mockClear()
}

export const navigationModule = () => ({
  usePathname: () => '/tasks',
  useRouter: () => ({ push: (to: string) => gSpies.pushes.push(to), replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  redirect: (to: string) => void gSpies.redirects.push(to),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
})

export const tasksDbModule = () => ({
  getTasks: async () => globalEnv.tasks,
  getTaskTmplts: async () => globalEnv.taskTmplts,
})

export const filterModule = () => ({
  getPerms: async () => ({ gotPermIds: [7, 12], gotPermUsers: GOT_PERM_USERS, gavePermUsers: GAVE_PERM_USERS }),
})

export const tasksActionsModule = () => ({
  addTask: (...a: unknown[]) => gSpies.addTask(...a),
  addTaskFromTmplt: (...a: unknown[]) => gSpies.addTaskFromTmplt(...a),
})

export const filesActionsModule = () => ({
  deleteFile: (...a: unknown[]) => gSpies.deleteFile(...a),
  addFilesToTask: async () => {},
  addFiles: async () => [],
  getPresigned: async () => [],
})
