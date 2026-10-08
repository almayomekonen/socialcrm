/**
 * Where each box sits on the canvas. Presentation only: computed from the
 * flow map and the boxes' measured sizes, never saved, never read by the
 * runtime. Boxes are not draggable, so this is always where they sit.
 *
 * Top to bottom, the order a conversation is read. dagre orders siblings left
 * to right in insertion order; the result is mirrored so the first answer's
 * route sits on the right, where a Hebrew reader starts.
 */
import dagre from '@dagrejs/dagre'
import type { FlowEdge } from '@/lib/inbox/autoresponse/questionnaire/builder/flowGraph'

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }

export const DEFAULT_SIZE: Size = { width: 340, height: 220 }

/** The vertical gap between rows of boxes. */
export const RANK_GAP = 64

/** How strongly an answer's route pulls its follow-up next to the question (dagre edge weight). */
const ANSWER_ROUTE_WEIGHT = 8

export function layoutFlow(nodeIds: string[], edges: FlowEdge[], sizes: Record<string, Size>): Record<string, Point> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 56, ranksep: RANK_GAP, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of nodeIds) g.setNode(id, { ...(sizes[id] ?? DEFAULT_SIZE) })
  // An answer's own route (to its follow-up) is kept short: the follow-up sits
  // right under the question that asks it, and the route then rejoins. Without
  // this, dagre is as happy to put a follow-up beside the ending (its other
  // edge) as beside its question. Presentation only: the edges are unchanged.
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target, { weight: e.option ? ANSWER_ROUTE_WEIGHT : 1 })
  dagre.layout(g)

  const out: Record<string, Point> = {}
  for (const id of nodeIds) {
    const n = g.node(id)
    const size = sizes[id] ?? DEFAULT_SIZE
    // dagre gives centres; React Flow positions top-left corners. Mirror x for RTL.
    out[id] = { x: -n.x - size.width / 2, y: n.y - size.height / 2 }
  }
  return out
}

/**
 * Where a "continue" arrow turns sideways (React Flow's smoothstep
 * stepPosition, 0..1 of the way down). An arrow that skips rows turns just
 * above the box it reaches, in the free gap, so it runs down its own lane
 * instead of crossing behind a box it does not go to. Short arrows turn
 * halfway, as before.
 */
export function stepPositionFor(sourceBottom: number, targetTop: number): number {
  const span = targetTop - sourceBottom
  return span > RANK_GAP * 2 ? 1 - RANK_GAP / 2 / span : 0.5
}
