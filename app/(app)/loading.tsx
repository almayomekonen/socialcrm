import AppSegmentLoading from '@/components/mobile/skeletons/AppSegmentLoading'

/**
 * Segment fallback once the mobile/desktop SHELL is already mounted.
 *
 * Must be synchronous. Reading request headers here is the stuck-skeleton
 * client-navigation failure under cacheComponents.
 */
export default function AppLoading() {
  return <AppSegmentLoading />
}
