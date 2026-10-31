import type { Messages } from '../../../translate'

type M = Messages['notifications']

export const category: M['category'] = {
  leads: 'Leads',
  messages: 'Conversations',
  followups: 'Follow-ups',
  sla: 'Response times',
  integrations: 'Connections',
}

export const panel: M['panel'] = {
  markAll: 'Mark all as read',
  viewAll: 'All notifications',
  away: {
    title: 'While you were away',
    count: { one: '1 new notification', other: '{count} new notifications' },
    category: '{label} {count}',
    separator: ', ',
  },
  empty: {
    title: 'No new notifications',
    body: 'When a new lead comes in or something needs attention, it will appear here.',
  },
}

export const center: M['center'] = {
  empty: {
    title: 'No notifications',
    filteredTitle: 'No notifications match the filter',
    filteredBody: 'Clear the filter to see all notifications.',
  },
  loadMore: 'Show more',
  loadFailed: "Couldn't load — try again",
}

export const filters: M['filters'] = {
  readState: 'Read state',
  category: 'Category',
  all: 'All',
  unread: 'Unread',
  allTypes: 'All types',
  mobileLabel: 'Filter notifications',
}

export const toast: M['toast'] = {
  many: { one: '{count} new notification', other: '{count} new notifications' },
}
