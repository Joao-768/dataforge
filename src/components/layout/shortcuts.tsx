'use client'

import { Kbd } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'

const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
    {
        title: 'Anywhere',
        items: [
            { keys: ['?'], label: 'Show this reference' },
            { keys: ['Alt', '1–8'], label: 'Switch workspace section' },
        ],
    },
    {
        title: 'SQL editor',
        items: [
            {
                keys: ['⌘/Ctrl', 'Enter'],
                label: 'Run selection, or the statement under the cursor',
            },
            { keys: ['⌘/Ctrl', 'Shift', 'Enter'], label: 'Run the whole script' },
            { keys: ['⌘/Ctrl', 'E'], label: 'Explain the current statement' },
            { keys: ['⌘/Ctrl', 'S'], label: 'Save the query' },
            { keys: ['Shift', 'Alt', 'F'], label: 'Format SQL' },
            { keys: ['Alt', 'N'], label: 'New tab' },
            { keys: ['Esc'], label: 'Cancel the running query' },
        ],
    },
    {
        title: 'Schema designer',
        items: [
            { keys: ['⌘/Ctrl', 'Z'], label: 'Undo' },
            { keys: ['⌘/Ctrl', 'Shift', 'Z'], label: 'Redo' },
            { keys: ['T'], label: 'Add a table' },
            { keys: ['Delete'], label: 'Delete the selected table or relationship' },
            { keys: ['F'], label: 'Fit the schema in view' },
            { keys: ['L'], label: 'Arrange tables automatically' },
        ],
    },
]

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    return (
        <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" size="md">
            <div className="space-y-5">
                {GROUPS.map((group) => (
                    <section key={group.title}>
                        <h3 className="eyebrow mb-2">{group.title}</h3>
                        <ul className="rows rounded-md border border-rule">
                            {group.items.map((item) => (
                                <li
                                    key={item.label}
                                    className="flex items-center justify-between gap-4 px-3 py-2 text-[13px]"
                                >
                                    <span className="text-ink-2">{item.label}</span>
                                    <span className="flex shrink-0 items-center gap-1">
                                        {item.keys.map((key) => (
                                            <Kbd key={key}>{key}</Kbd>
                                        ))}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </Dialog>
    )
}
