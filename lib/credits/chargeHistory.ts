/** One newest-first charge list: subscription payments and confirmed credit packs. */
export function mergeChargeHistory<A extends { createdAt: Date | string }, B extends { createdAt: Date | string }>(payments: readonly A[], packs: readonly B[]): (A | B)[] {
  const at = (c: { createdAt: Date | string }) => new Date(c.createdAt).getTime()
  return [...payments, ...packs].sort((a, b) => at(b) - at(a))
}
