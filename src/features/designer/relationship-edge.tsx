'use client'

import { memo } from 'react'
import {
    BaseEdge,
    EdgeLabelRenderer,
    getSmoothStepPath,
    type Edge,
    type EdgeProps,
} from '@xyflow/react'

export type RelationshipEdgeData = {
    label: string
    active: boolean
    nullable: boolean
}

export type RelationshipFlowEdge = Edge<RelationshipEdgeData, 'relationship'>

/**
 * Crow's-foot notation: the fork sits on the referencing ("many") side, a
 * bar on the referenced ("one") side. A dashed line means the foreign key
 * column is nullable (the relationship is optional).
 */
function RelationshipEdgeComponent({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    selected,
    data,
}: EdgeProps<RelationshipFlowEdge>) {
    const [path, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        borderRadius: 10,
        offset: 18,
    })
    const highlighted = selected || data?.active
    const stroke = selected ? 'var(--accent)' : highlighted ? 'var(--edge-active)' : 'var(--edge)'
    return (
        <>
            <BaseEdge
                id={id}
                path={path}
                markerStart={selected ? 'url(#df-many-active)' : 'url(#df-many)'}
                markerEnd={selected ? 'url(#df-one-active)' : 'url(#df-one)'}
                style={{
                    stroke,
                    strokeWidth: highlighted ? 1.6 : 1.2,
                    strokeDasharray: data?.nullable ? '5 4' : undefined,
                }}
                interactionWidth={14}
            />
            {highlighted && data?.label ? (
                <EdgeLabelRenderer>
                    <div
                        className="pointer-events-none absolute rounded border border-rule bg-panel px-1.5 py-0.5 font-mono text-[10px] text-ink-2"
                        style={{
                            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                        }}
                    >
                        {data.label}
                    </div>
                </EdgeLabelRenderer>
            ) : null}
        </>
    )
}

export const RelationshipEdge = memo(RelationshipEdgeComponent)

/** SVG marker definitions referenced by the edges. Rendered once per canvas. */
export function RelationshipMarkers() {
    const marker = (id: string, color: string, kind: 'many' | 'one') => (
        <marker
            key={id}
            id={id}
            viewBox="0 0 16 16"
            refX={kind === 'many' ? 1 : 15}
            refY="8"
            markerWidth="16"
            markerHeight="16"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
        >
            {kind === 'many' ? (
                <path
                    d="M15 8 L1 1.5 M15 8 L1 8 M15 8 L1 14.5"
                    fill="none"
                    stroke={color}
                    strokeWidth="1.3"
                />
            ) : (
                <path d="M11 2 L11 14 M1 8 L15 8" fill="none" stroke={color} strokeWidth="1.3" />
            )}
        </marker>
    )
    return (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
            <defs>
                {marker('df-many', 'var(--edge)', 'many')}
                {marker('df-one', 'var(--edge)', 'one')}
                {marker('df-many-active', 'var(--accent)', 'many')}
                {marker('df-one-active', 'var(--accent)', 'one')}
            </defs>
        </svg>
    )
}
