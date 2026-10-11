'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Background,
    BackgroundVariant,
    ConnectionMode,
    Controls,
    MiniMap,
    ReactFlow,
    useReactFlow,
    type Connection,
    type NodeChange,
    type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import { useToast } from '@/components/ui/toast'
import { useResolvedTheme } from '@/lib/theme'
import type { DraftDocument, Position } from '@/shared/schema/model'
import type { SchemaIssue } from '@/shared/schema/validate'
import { NODE_WIDTH } from '@/features/designer/layout'
import {
    addTable,
    connectColumns,
    deleteForeignKey,
    deleteTable,
    setPositions,
} from '@/features/designer/operations'
import {
    RelationshipEdge,
    RelationshipMarkers,
    type RelationshipFlowEdge,
} from '@/features/designer/relationship-edge'
import { useDesigner } from '@/features/designer/store'
import { TableNode, type TableFlowNode } from '@/features/designer/table-node'

const nodeTypes = { table: TableNode }
const edgeTypes = { relationship: RelationshipEdge }

function isTyping(target: EventTarget | null) {
    return Boolean(
        (target as HTMLElement | null)?.closest(
            'input, textarea, select, [contenteditable="true"]',
        ),
    )
}

export function DesignerCanvas({
    tableStatus,
    issues,
    onArrange,
}: {
    tableStatus: Map<string, 'new' | 'changed'>
    issues: SchemaIssue[]
    onArrange: () => void
}) {
    const document = useDesigner((state) => state.document)!
    const selection = useDesigner((state) => state.selection)
    const apply = useDesigner((state) => state.apply)
    const select = useDesigner((state) => state.select)
    const commitFrom = useDesigner((state) => state.commitFrom)
    const flow = useReactFlow()
    const toast = useToast()
    const theme = useResolvedTheme()
    const dragStart = useRef<DraftDocument | null>(null)
    // Sizes React Flow measured from the DOM; controlled nodes must carry them.
    const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({})

    const selectedTableId = selection.kind === 'none' ? null : selection.tableId
    const selectedColumnId = selection.kind === 'table' ? (selection.columnId ?? null) : null

    const onSelectColumn = useCallback(
        (tableId: string, columnId: string) => select({ kind: 'table', tableId, columnId }),
        [select],
    )

    const issueByTable = useMemo(() => {
        const map = new Map<string, 'error' | 'warning'>()
        for (const issue of issues) {
            if (issue.severity === 'error' || !map.has(issue.tableId))
                map.set(issue.tableId, issue.severity)
        }
        return map
    }, [issues])

    const relatedIds = useMemo(() => {
        const related = new Set<string>()
        if (!selectedTableId) return related
        for (const table of document.tables) {
            for (const key of table.foreignKeys) {
                if (table.id === selectedTableId) related.add(key.refTableId)
                if (key.refTableId === selectedTableId) related.add(table.id)
            }
        }
        return related
    }, [document.tables, selectedTableId])

    const nodes = useMemo<TableFlowNode[]>(
        () =>
            document.tables.map((table) => ({
                id: table.id,
                type: 'table',
                position: document.positions[table.id] ?? { x: 0, y: 0 },
                measured: measured[table.id],
                selected: table.id === selectedTableId,
                data: {
                    table,
                    status: tableStatus.get(table.id) ?? null,
                    issue: issueByTable.get(table.id) ?? null,
                    selectedColumnId: table.id === selectedTableId ? selectedColumnId : null,
                    related: relatedIds.has(table.id),
                    onSelectColumn,
                },
            })),
        [
            document,
            measured,
            selectedTableId,
            selectedColumnId,
            tableStatus,
            issueByTable,
            relatedIds,
            onSelectColumn,
        ],
    )

    const edges = useMemo<RelationshipFlowEdge[]>(() => {
        const result: RelationshipFlowEdge[] = []
        const byId = new Map(document.tables.map((table) => [table.id, table]))
        for (const table of document.tables) {
            for (const key of table.foreignKeys) {
                const target = byId.get(key.refTableId)
                const sourceColumn = key.columns[0]
                const targetColumn = key.refColumns[0]
                if (!target || !sourceColumn || !targetColumn) continue
                const from = document.positions[table.id] ?? { x: 0, y: 0 }
                const to = document.positions[target.id] ?? { x: 0, y: 0 }
                // Leave from the side facing the referenced table.
                const leftToRight = from.x + NODE_WIDTH / 2 <= to.x + NODE_WIDTH / 2
                const selfReference = table.id === target.id
                const local = table.columns.find((column) => column.id === sourceColumn)
                result.push({
                    id: key.id,
                    type: 'relationship',
                    source: table.id,
                    target: target.id,
                    sourceHandle: `${sourceColumn}:${selfReference || leftToRight ? 'r' : 'l'}`,
                    targetHandle: `${targetColumn}:${selfReference ? 'r' : leftToRight ? 'l' : 'r'}`,
                    selected:
                        selection.kind === 'relationship' && selection.foreignKeyId === key.id,
                    data: {
                        label: `${local?.name ?? '?'} → ${target.name}${key.onDelete !== 'NO ACTION' ? ` · on delete ${key.onDelete.toLowerCase()}` : ''}`,
                        active: table.id === selectedTableId || target.id === selectedTableId,
                        nullable: key.columns.some(
                            (id) => table.columns.find((column) => column.id === id)?.nullable,
                        ),
                    },
                })
            }
        }
        return result
    }, [document, selection, selectedTableId])

    const onNodesChange = useCallback(
        (changes: NodeChange<TableFlowNode>[]) => {
            const moved: Record<string, Position> = {}
            const sizes: Record<string, { width: number; height: number }> = {}
            for (const change of changes) {
                if (change.type === 'position' && change.position)
                    moved[change.id] = change.position
                if (change.type === 'dimensions' && change.dimensions)
                    sizes[change.id] = change.dimensions
            }
            if (Object.keys(sizes).length > 0) setMeasured((current) => ({ ...current, ...sizes }))
            if (Object.keys(moved).length > 0) {
                apply((current) => setPositions(current, moved), { record: false })
            }
        },
        [apply],
    )

    const onNodeDragStart: OnNodeDrag<TableFlowNode> = useCallback(() => {
        dragStart.current = useDesigner.getState().document
    }, [])

    const onNodeDragStop: OnNodeDrag<TableFlowNode> = useCallback(() => {
        if (dragStart.current) commitFrom(dragStart.current)
        dragStart.current = null
    }, [commitFrom])

    const onConnect = useCallback(
        (connection: Connection) => {
            const sourceColumn = connection.sourceHandle?.split(':')[0]
            const targetColumn = connection.targetHandle?.split(':')[0]
            if (!sourceColumn || !targetColumn) return
            const current = useDesigner.getState().document
            if (!current) return
            const result = connectColumns(
                current,
                { tableId: connection.source, columnId: sourceColumn },
                { tableId: connection.target, columnId: targetColumn },
            )
            if ('error' in result) {
                toast(result.error, 'error')
                return
            }
            apply(() => result.document)
            const owner = result.document.tables.find((table) =>
                table.foreignKeys.some((key) => key.id === result.foreignKeyId),
            )
            if (owner)
                select({
                    kind: 'relationship',
                    tableId: owner.id,
                    foreignKeyId: result.foreignKeyId,
                })
        },
        [apply, select, toast],
    )

    const addTableAt = useCallback(
        (position: Position) => {
            const current = useDesigner.getState().document
            if (!current) return
            const result = addTable(current, position)
            apply(() => result.document)
            select({ kind: 'table', tableId: result.tableId })
        },
        [apply, select],
    )

    // Canvas keyboard shortcuts.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (isTyping(event.target) || event.altKey) return
            const mod = event.metaKey || event.ctrlKey
            const state = useDesigner.getState()
            if (mod && event.key.toLowerCase() === 'z') {
                event.preventDefault()
                if (event.shiftKey) state.redo()
                else state.undo()
                return
            }
            if (mod && event.key.toLowerCase() === 'y') {
                event.preventDefault()
                state.redo()
                return
            }
            if (mod) return
            if (event.key === 'Delete' || event.key === 'Backspace') {
                const current = state.selection
                if (current.kind === 'table' && !current.columnId) {
                    event.preventDefault()
                    state.apply((doc) => deleteTable(doc, current.tableId))
                    state.select({ kind: 'none' })
                } else if (current.kind === 'relationship') {
                    event.preventDefault()
                    state.apply((doc) =>
                        deleteForeignKey(doc, current.tableId, current.foreignKeyId),
                    )
                    state.select({ kind: 'table', tableId: current.tableId })
                }
            } else if (event.key === 't' || event.key === 'T') {
                event.preventDefault()
                const center = flow.screenToFlowPosition({
                    x: window.innerWidth / 2,
                    y: window.innerHeight / 2,
                })
                addTableAt({
                    x: Math.round(center.x - NODE_WIDTH / 2),
                    y: Math.round(center.y - 60),
                })
            } else if (event.key === 'f' || event.key === 'F') {
                event.preventDefault()
                void flow.fitView({ padding: 0.15, duration: 250 })
            } else if (event.key === 'l' || event.key === 'L') {
                event.preventDefault()
                onArrange()
            } else if (event.key === 'Escape') {
                state.select({ kind: 'none' })
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [flow, addTableAt, onArrange])

    return (
        <div className="relative h-full w-full" aria-label="Schema canvas">
            <RelationshipMarkers />
            <ReactFlow<TableFlowNode, RelationshipFlowEdge>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onNodeDragStart={onNodeDragStart}
                onNodeDragStop={onNodeDragStop}
                onConnect={onConnect}
                connectionMode={ConnectionMode.Loose}
                onNodeClick={(_, node) => {
                    const current = useDesigner.getState().selection
                    if (current.kind === 'table' && current.tableId === node.id && current.columnId)
                        return
                    select({ kind: 'table', tableId: node.id })
                }}
                onEdgeClick={(_, edge) =>
                    select({ kind: 'relationship', tableId: edge.source, foreignKeyId: edge.id })
                }
                onPaneClick={() => select({ kind: 'none' })}
                onDoubleClick={(event) => {
                    if ((event.target as HTMLElement).closest('.react-flow__node')) return
                    const position = flow.screenToFlowPosition({
                        x: event.clientX,
                        y: event.clientY,
                    })
                    addTableAt({
                        x: Math.round(position.x - NODE_WIDTH / 2),
                        y: Math.round(position.y - 20),
                    })
                }}
                zoomOnDoubleClick={false}
                deleteKeyCode={null}
                selectionKeyCode={null}
                multiSelectionKeyCode={null}
                minZoom={0.15}
                maxZoom={1.8}
                fitView
                fitViewOptions={{ padding: 0.15 }}
                colorMode={theme}
                proOptions={{ hideAttribution: true }}
                connectionLineStyle={{ stroke: 'var(--accent)', strokeWidth: 1.5 }}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={20}
                    size={1}
                    color="var(--canvas-dot)"
                />
                <Controls showInteractive={false} position="bottom-left" />
                <MiniMap
                    style={{ width: 168, height: 112 }}
                    pannable
                    zoomable
                    position="bottom-right"
                    nodeColor={() => 'var(--rule-strong)'}
                    nodeStrokeWidth={0}
                    maskColor="var(--minimap-mask)"
                    ariaLabel="Schema overview"
                />
            </ReactFlow>
        </div>
    )
}
