import LeadsTableSkeleton from '@/components/clients/LeadsTableSkeleton'

/** Closed-leads list — same table chrome without status tabs. */
export default function Loading() {
  return <LeadsTableSkeleton withStatusTabs={false} />
}
