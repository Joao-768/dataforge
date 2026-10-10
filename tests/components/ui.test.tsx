import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Cell, toCsv } from '@/components/data-grid'
import { ConfirmDialog } from '@/components/ui/dialog'
import { highlightSql } from '@/components/sql-block'
import { PlanView } from '@/features/sql/plan-view'

describe('Cell', () => {
    it('distinguishes NULL from an empty string', () => {
        const { container } = render(
            <>
                <Cell value={null} type="text" />
                <Cell value="" type="text" />
            </>,
        )
        expect(screen.getByText('NULL')).toBeInTheDocument()
        expect(container.textContent).toBe('NULL')
    })
    it('renders booleans and JSON as text', () => {
        render(
            <>
                <Cell value={true} type="boolean" />
                <Cell value={{ a: 1 }} type="jsonb" />
            </>,
        )
        expect(screen.getByText('true')).toBeInTheDocument()
        expect(screen.getByText('{"a":1}')).toBeInTheDocument()
    })
})

describe('toCsv', () => {
    it('quotes per RFC 4180 and writes NULL as empty', () => {
        expect(
            toCsv(
                [
                    { name: 'a', type: 'text' },
                    { name: 'b', type: 'jsonb' },
                ],
                [
                    ['x, "y"', null],
                    ['z', { k: 1 }],
                ],
            ),
        ).toBe('a,b\r\n"x, ""y""",\r\nz,"{""k"":1}"\r\n')
    })
})

describe('ConfirmDialog', () => {
    it('enables the action only after the confirmation text is typed', async () => {
        const onConfirm = vi.fn()
        render(
            <ConfirmDialog
                open
                onClose={() => undefined}
                onConfirm={onConfirm}
                title="Delete project"
                confirmLabel="Delete"
                confirmText="inventory"
            >
                <p>Gone for good.</p>
            </ConfirmDialog>,
        )
        const button = screen.getByRole('button', { name: 'Delete' })
        expect(button).toBeDisabled()
        await userEvent.type(screen.getByLabelText('Type inventory to confirm'), 'inventory')
        expect(button).toBeEnabled()
        await userEvent.click(button)
        expect(onConfirm).toHaveBeenCalledOnce()
    })
})

describe('PlanView', () => {
    it('labels estimated plans and flags misestimates in analyzed ones', () => {
        const plan = {
            Plan: {
                'Node Type': 'Seq Scan',
                'Relation Name': 'orders',
                'Startup Cost': 0,
                'Total Cost': 100,
                'Plan Rows': 10,
                'Plan Width': 8,
                'Actual Total Time': 5,
                'Actual Rows': 5000,
                'Actual Loops': 1,
                'Rows Removed by Filter': 20000,
            },
        }
        const { rerender } = render(
            <PlanView
                result={{
                    analyzed: false,
                    plan: [plan],
                    planningMs: 0.1,
                    executionMs: null,
                    durationMs: 2,
                }}
            />,
        )
        expect(screen.getByText('Estimated plan · EXPLAIN')).toBeInTheDocument()
        expect(screen.getByText(/planner units/)).toBeInTheDocument()
        rerender(
            <PlanView
                result={{
                    analyzed: true,
                    plan: [plan],
                    planningMs: 0.1,
                    executionMs: 5,
                    durationMs: 6,
                }}
            />,
        )
        expect(screen.getByText('Actual execution · EXPLAIN ANALYZE')).toBeInTheDocument()
        expect(screen.getByText(/Row estimate off by 500×/)).toBeInTheDocument()
        expect(screen.getByText(/discarded 20,000 rows/)).toBeInTheDocument()
    })
})

it('highlights SQL keywords without altering the text', () => {
    const { container } = render(<pre>{highlightSql("SELECT 'a' -- c\nFROM t")}</pre>)
    expect(container.textContent).toBe("SELECT 'a' -- c\nFROM t")
})
