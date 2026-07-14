/**
 * Re-export shared poll schedule from lib/polling (Wave A11 move).
 * Inbox keeps importing from this path so call sites stay stable.
 */
export { nextInterval, type PollBand, type NextIntervalOpts } from '@/lib/polling/pollSchedule'
