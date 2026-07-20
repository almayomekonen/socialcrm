// Today brief — inbound data freshness (Amendment/P0.3, C3).
//
// INTERIM: no per-agency sync-health signal exists yet (the codebase only has
// per-conversation lastInboundAt, which cannot distinguish "quiet" from "webhook
// down"). Until a `lastSuccessfulInboundSyncAt` signal is added, freshness cannot
// be confirmed, so we return dataFresh=false. Per verdict.ts this keeps the brief
// from ever falsely asserting "covered" (INV-9) — it degrades to a scoped/
// unconfirmed claim, which is the honest, conservative behavior. When the C3
// signal lands, this is the single place that changes; no consumer is touched.

export async function getInboundSyncFreshness(): Promise<{ dataFresh: boolean }> {
  return { dataFresh: false }
}
