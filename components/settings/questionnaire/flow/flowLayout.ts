/**
 * Where each box sits on the canvas. Presentation only: computed from the
 * flow map and the boxes' measured sizes, never saved, never read by the
 * runtime. The owner can drag boxes; "סידור מחדש" returns to this layout.
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

export function layoutFlow(nodeIds: string[], edges: FlowEdge[], sizes: Record<string, Size>): Record<string, Point> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 56, ranksep: 64, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of nodeIds) g.setNode(id, { ...(sizes[id] ?? DEFAULT_SIZE) })
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
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
