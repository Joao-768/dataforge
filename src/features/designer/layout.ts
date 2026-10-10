import dagre from '@dagrejs/dagre'
import type { Position, SchemaTable } from '@/shared/schema/model'

// Automatic arrangement with dagre: referenced tables (parents) to the left
// of the tables that reference them, so relationships read left to right.

export const NODE_WIDTH = 264
const HEADER_HEIGHT = 40
const ROW_HEIGHT = 26
const FOOTER_HEIGHT = 26

export function nodeHeight(table: SchemaTable): number {
    return HEADER_HEIGHT + Math.max(1, table.columns.length) * ROW_HEIGHT + FOOTER_HEIGHT
}

export function autoLayout(tables: SchemaTable[]): Record<string, Position> {
    const graph = new dagre.graphlib.Graph()
    graph.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 110, marginx: 40, marginy: 40 })
    graph.setDefaultEdgeLabel(() => ({}))
    for (const table of tables) {
        graph.setNode(table.id, { width: NODE_WIDTH, height: nodeHeight(table) })
    }
    const ids = new Set(tables.map((table) => table.id))
    for (const table of tables) {
        for (const key of table.foreignKeys) {
            if (ids.has(key.refTableId) && key.refTableId !== table.id)
                graph.setEdge(key.refTableId, table.id)
        }
    }
    dagre.layout(graph)
    const positions: Record<string, Position> = {}
    for (const table of tables) {
        const node = graph.node(table.id)
        positions[table.id] = {
            x: Math.round(node.x - NODE_WIDTH / 2),
            y: Math.round(node.y - nodeHeight(table) / 2),
        }
    }
    return positions
}

/** A free spot to the right of everything, for a new table. */
export function nextFreePosition(positions: Record<string, Position>): Position {
    const values = Object.values(positions)
    if (values.length === 0) return { x: 80, y: 80 }
    const right = Math.max(...values.map((position) => position.x))
    const top = Math.min(...values.map((position) => position.y))
    return { x: right + NODE_WIDTH + 80, y: top }
}
