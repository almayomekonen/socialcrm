import type { Messages } from '../../../translate'

type L = Messages['leadTabs']

/** "מעקב" here is a TASK (glossary D1.3 flags), so it is "Task", never "Follow-up". */
export const tasks: L['tasks'] = {
  status: {
    new: 'New',
    inProgress: 'In progress',
    awaitingReply: 'Awaiting reply',
    reassigned: 'Moved to another rep',
    notRelevant: 'Not relevant',
    notInterested: 'Not interested',
    closed: 'Closed',
    handled: 'Handling complete',
  },
  table: {
    statusFilter: 'Status',
    handlerFilter: 'Assigned to',
    create: 'Create task',
    header: {
      title: 'Title',
      status: 'Status',
      userName: 'Assigned to',
      completed: 'Done',
      dueDate: 'Due date',
      createdAt: 'Created',
      updatedAt: 'Last activity',
    },
  },
  form: {
    title: 'Create a new task',
    leadLabel: 'Lead',
    leadPlaceholder: 'Choose a lead',
    taskTitleLabel: 'Task title',
    taskTitlePlaceholder: 'e.g. Follow up on the price quote',
    create: 'Create task',
    templateLabel: 'Or choose a template',
    createFromTemplate: 'Create task from template',
    titleRequired: 'Enter a task title',
    leadRequired: 'Choose a lead',
  },
  detail: {
    markDone: 'Mark as done',
    unmarkDone: 'Mark as not done',
    repPlaceholder: 'Rep',
    statusPlaceholder: 'Status',
    titleLabel: 'Title',
    titleRequired: 'Enter a title',
    edit: 'Edit',
    delete: 'Delete',
  },
  notes: {
    title: 'Notes',
    placeholder: 'Add an update: what happened with the lead?',
    required: 'Enter the note text',
    add: 'Add update',
    deleteNote: 'Delete note',
  },
}
