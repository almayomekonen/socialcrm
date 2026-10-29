import { vi } from 'vitest'

/**
 * Shared spies behind the lead-tabs locale and behaviour tests. The `vi.mock`
 * calls themselves must live in each test file (they are hoisted per file);
 * their factories read these spies, so both files record the same way.
 */
export const tabsSpies = {
  prefs: { userLocale: 'en' as string | null },
  toasts: [] as unknown[][],
  pushes: [] as string[],
  attachOk: true,
  picked: [] as unknown[],
  addTask: vi.fn(async (..._a: unknown[]) => 99),
  addTaskFromTmplt: vi.fn(async (..._a: unknown[]) => 98),
  updateFullTask: vi.fn(async (..._a: unknown[]) => {}),
  deleteTask: vi.fn(async (..._a: unknown[]) => {}),
  deleteFile: vi.fn(async (..._a: unknown[]) => {}),
  addFilesToTask: vi.fn(async (..._a: unknown[]) => {}),
  attachDriveFile: vi.fn(async (..._a: unknown[]) => ({ ok: tabsSpies.attachOk })),
  detachDriveFile: vi.fn(async (..._a: unknown[]) => ({ ok: tabsSpies.attachOk })),
}

export function resetTabsSpies() {
  tabsSpies.toasts.length = 0
  tabsSpies.pushes.length = 0
  tabsSpies.attachOk = true
  tabsSpies.picked = []
  for (const fn of [
    tabsSpies.addTask,
    tabsSpies.addTaskFromTmplt,
    tabsSpies.updateFullTask,
    tabsSpies.deleteTask,
    tabsSpies.deleteFile,
    tabsSpies.addFilesToTask,
    tabsSpies.attachDriveFile,
    tabsSpies.detachDriveFile,
  ]) {
    fn.mockClear()
  }
}
