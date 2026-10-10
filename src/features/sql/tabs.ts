'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// Query tabs, kept in this browser per project, so an unsaved query survives
// a reload. Results are not persisted.

export interface QueryTab {
    id: string
    title: string
    sql: string
    savedQueryId: string | null
}

interface TabsState {
    projects: Record<string, { tabs: QueryTab[]; activeId: string }>
    ensure(projectId: string): void
    open(projectId: string, tab?: Partial<QueryTab>): string
    close(projectId: string, tabId: string): void
    activate(projectId: string, tabId: string): void
    update(projectId: string, tabId: string, patch: Partial<QueryTab>): void
}

function blankTab(index: number, patch: Partial<QueryTab> = {}): QueryTab {
    return {
        id: crypto.randomUUID(),
        title: `Query ${index}`,
        sql: '-- Read-only by default. Switch to Write to change data.\nSELECT *\nFROM ',
        savedQueryId: null,
        ...patch,
    }
}

export const useQueryTabs = create<TabsState>()(
    persist(
        (set, get) => ({
            projects: {},
            ensure(projectId) {
                if (get().projects[projectId]?.tabs.length) return
                const tab = blankTab(1)
                set((state) => ({
                    projects: { ...state.projects, [projectId]: { tabs: [tab], activeId: tab.id } },
                }))
            },
            open(projectId, patch = {}) {
                const current = get().projects[projectId] ?? { tabs: [], activeId: '' }
                const existing = patch.savedQueryId
                    ? current.tabs.find((tab) => tab.savedQueryId === patch.savedQueryId)
                    : null
                if (existing) {
                    set((state) => ({
                        projects: {
                            ...state.projects,
                            [projectId]: { ...current, activeId: existing.id },
                        },
                    }))
                    return existing.id
                }
                const tab = blankTab(current.tabs.length + 1, patch)
                set((state) => ({
                    projects: {
                        ...state.projects,
                        [projectId]: { tabs: [...current.tabs, tab].slice(-12), activeId: tab.id },
                    },
                }))
                return tab.id
            },
            close(projectId, tabId) {
                const current = get().projects[projectId]
                if (!current) return
                const index = current.tabs.findIndex((tab) => tab.id === tabId)
                let tabs = current.tabs.filter((tab) => tab.id !== tabId)
                if (tabs.length === 0) tabs = [blankTab(1)]
                const activeId =
                    current.activeId === tabId ? tabs[Math.max(0, index - 1)]!.id : current.activeId
                set((state) => ({
                    projects: { ...state.projects, [projectId]: { tabs, activeId } },
                }))
            },
            activate(projectId, tabId) {
                const current = get().projects[projectId]
                if (!current) return
                set((state) => ({
                    projects: { ...state.projects, [projectId]: { ...current, activeId: tabId } },
                }))
            },
            update(projectId, tabId, patch) {
                const current = get().projects[projectId]
                if (!current) return
                set((state) => ({
                    projects: {
                        ...state.projects,
                        [projectId]: {
                            ...current,
                            tabs: current.tabs.map((tab) =>
                                tab.id === tabId ? { ...tab, ...patch } : tab,
                            ),
                        },
                    },
                }))
            },
        }),
        { name: 'dataforge:sql-tabs', storage: createJSONStorage(() => localStorage), version: 1 },
    ),
)
