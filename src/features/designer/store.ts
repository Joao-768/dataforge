'use client'

import { create } from 'zustand'
import type { DraftDocument, SchemaTable } from '@/shared/schema/model'

// Designer state. The document is immutable: every edit replaces it, and the
// previous version goes on the undo stack. Dragging a table only records a
// history entry when the drag ends, so undo steps match user intent.

export type Selection =
    | { kind: 'none' }
    | { kind: 'table'; tableId: string; columnId?: string }
    | { kind: 'relationship'; tableId: string; foreignKeyId: string }

export type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'conflict'

const HISTORY_LIMIT = 100

interface DesignerState {
    document: DraftDocument | null
    base: SchemaTable[]
    revision: number
    selection: Selection
    past: DraftDocument[]
    future: DraftDocument[]
    saveState: SaveState
    /** Bumped on every edit; autosave compares it with what it last sent. */
    version: number

    load(document: DraftDocument, base: SchemaTable[], revision: number): void
    apply(change: (document: DraftDocument) => DraftDocument, options?: { record?: boolean }): void
    /** Records `before` as an undo step for a change already applied (drags). */
    commitFrom(before: DraftDocument): void
    select(selection: Selection): void
    undo(): void
    redo(): void
    setSaveState(state: SaveState): void
    setRevision(revision: number): void
}

export const useDesigner = create<DesignerState>((set, get) => ({
    document: null,
    base: [],
    revision: 0,
    selection: { kind: 'none' },
    past: [],
    future: [],
    saveState: 'saved',
    version: 0,

    load(document, base, revision) {
        set({
            document,
            base,
            revision,
            past: [],
            future: [],
            selection: { kind: 'none' },
            saveState: 'saved',
            version: 0,
        })
    },

    apply(change, { record = true } = {}) {
        const current = get().document
        if (!current) return
        const next = change(current)
        if (next === current) return
        set((state) => ({
            document: next,
            past: record ? [...state.past, current].slice(-HISTORY_LIMIT) : state.past,
            future: record ? [] : state.future,
            version: state.version + 1,
            saveState: 'pending',
        }))
    },

    commitFrom(before) {
        set((state) => ({ past: [...state.past, before].slice(-HISTORY_LIMIT), future: [] }))
    },

    select(selection) {
        set({ selection })
    },

    undo() {
        const { past, document } = get()
        const previous = past.at(-1)
        if (!previous || !document) return
        set((state) => ({
            document: previous,
            past: state.past.slice(0, -1),
            future: [document, ...state.future].slice(0, HISTORY_LIMIT),
            version: state.version + 1,
            saveState: 'pending',
            selection: fixSelection(state.selection, previous),
        }))
    },

    redo() {
        const { future, document } = get()
        const next = future[0]
        if (!next || !document) return
        set((state) => ({
            document: next,
            past: [...state.past, document].slice(-HISTORY_LIMIT),
            future: state.future.slice(1),
            version: state.version + 1,
            saveState: 'pending',
            selection: fixSelection(state.selection, next),
        }))
    },

    setSaveState(saveState) {
        set({ saveState })
    },

    setRevision(revision) {
        set({ revision })
    },
}))

/** Drops a selection that no longer exists after undo or redo. */
function fixSelection(selection: Selection, document: DraftDocument): Selection {
    if (selection.kind === 'none') return selection
    const table = document.tables.find((candidate) => candidate.id === selection.tableId)
    if (!table) return { kind: 'none' }
    if (
        selection.kind === 'relationship' &&
        !table.foreignKeys.some((key) => key.id === selection.foreignKeyId)
    ) {
        return { kind: 'table', tableId: table.id }
    }
    return selection
}
