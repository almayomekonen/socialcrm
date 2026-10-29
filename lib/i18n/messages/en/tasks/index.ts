import type { Messages } from '../../../translate'

type L = Messages['tasks']

/** "מעקב" here is a TASK (glossary D1.3 flags), so it is "Task", never "Follow-up". */
export const tasks: L = {
  page: {
    title: 'Tasks',
    description: 'All lead tasks',
    actions: 'Actions',
    reps: 'Reps',
    filter: 'Filter',
    clearFilter: 'Clear filters',
    create: 'New task',
    empty: 'No tasks yet',
    count: { one: '{count} task', other: '{count} tasks' },
    active: { one: '{count} active', other: '{count} active' },
    done: { one: '{count} done', other: '{count} done' },
    overdue: { one: '{count} overdue', other: '{count} overdue' },
    header: {
      title: 'Task',
      status: 'Status',
      clientName: 'Lead',
      completed: 'Done',
      userName: 'Rep',
      dueDate: 'Due date',
      createdAt: 'Created',
      updatedAt: 'Last activity',
    },
  },
  files: {
    title: 'Files',
    leadFilter: 'Lead',
    empty: 'No files yet',
    clientNameHeader: 'Lead',
  },
}
