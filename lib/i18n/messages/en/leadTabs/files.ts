import type { Messages } from '../../../translate'

type L = Messages['leadTabs']

export const files: L['files'] = {
  title: "Lead's files",
  typeFilter: 'File type',
  sizeFilter: 'Size',
  sizeUpTo: 'Up to {size}',
  upload: 'Upload files',
  deleteColumn: 'Delete',
  deleteButton: 'Delete the document {name}',
  deleteConfirm: 'Delete the document {name}?',
  header: {
    type: 'File type',
    name: 'Document name',
    taskId: 'Task',
    createdAt: 'Created',
    size: 'Size',
    createdByName: 'Uploaded by',
  },
  form: {
    title: 'Add new files',
    taskLink: 'Link to a task (optional):',
    taskLabel: 'Task',
    submit: 'Add files',
    noFiles: 'Upload at least one file',
  },
  uploader: {
    title: 'Upload files',
    removeConfirm: 'Remove this file?',
    failed: 'File upload failed: {reason}',
    expired: 'Renew your subscription to upload files again',
    gallery: 'Choose from gallery',
    unavailable: 'Cannot be displayed',
  },
}

export const drive: L['drive'] = {
  attach: 'Attach a file from Drive',
  expired: 'Renew your subscription to attach files again',
  empty: 'No Drive files are attached to this lead.',
  suggested: 'Suggested: found in Drive from the lead details',
  attached: 'File attached to the lead',
  attachedMany: { one: '{count} file attached', other: '{count} files attached' },
  attachFailed: 'Attaching failed. Try again.',
  detached: 'File removed',
  detachFailed: 'Removing failed. Try again.',
  open: 'Open',
  detach: 'Remove',
  repick: 'Attach again',
  repicked: 'File updated from Drive',
  repickFailed: 'Updating failed. Try again.',
  loading: 'Loading…',
  attachOne: 'Attach',
  attaching: 'Attaching…',
  dialog: {
    label: 'Attach a file from Google Drive',
    title: 'Attach a file from Google Drive',
    intro: 'Search your Drive files and choose the file to attach to the lead.',
    searchPlaceholder: 'Search files by name or content…',
    minChars: 'Type at least 2 characters',
    noResults: 'No files found',
    close: 'Close',
  },
  picker: {
    intro: 'Choose a file from Drive to attach to the lead.',
    pick: 'Choose a file from Drive',
    unconfigured: 'The Picker is not configured.',
    failed: 'The Picker could not open. Try again.',
  },
}
