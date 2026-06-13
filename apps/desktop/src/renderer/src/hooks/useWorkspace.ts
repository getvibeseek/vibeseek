import { useCallback, useEffect, useRef, useState } from 'react'
import type { PersistedMessage, SessionMeta } from '../../../shared/ipc'

export interface Workspace {
  project: string | null
  recents: string[]
  /** Sessions grouped by project dir (covers every recent project). */
  sessionsByProject: Record<string, SessionMeta[]>
  currentId: string | null
  /** Messages of the currently selected session, plus a counter that bumps on each (re)load. */
  loaded: { key: number; messages: PersistedMessage[] }
  /** Display name of a project dir: user alias if set, else folder basename. */
  nameOf: (dir: string) => string
  pickProject: () => void
  switchProject: (dir: string) => void
  newSession: (dir?: string) => void
  selectSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  removeSession: (id: string) => void
  /** Branch a new conversation from a message and open it (Fork from here). */
  forkSession: (sessionId: string, messageId: number) => void
  /** Truncate at a message + roll back files, then reload the transcript (rewind). */
  rewindSession: (sessionId: string, messageId: number) => void
  /** Set (or clear, by passing the basename / empty) a project's display alias. */
  renameProject: (dir: string, name: string) => void
  /** Drop the selection so the composer is a fresh draft (lazy-create on send). */
  deselect: () => void
}

function baseName(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? dir
}

export function useWorkspace(): Workspace {
  const [project, setProject] = useState<string | null>(null)
  const [recents, setRecents] = useState<string[]>([])
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SessionMeta[]>>({})
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<{ key: number; messages: PersistedMessage[] }>({
    key: 0,
    messages: [],
  })
  const [aliases, setAliases] = useState<Record<string, string>>({})
  const prevCurrent = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    const [dir, recentDirs, current, settings] = await Promise.all([
      window.api.project.get(),
      window.api.project.recents(),
      window.api.session.current(),
      window.api.settings.getAll(),
    ])
    setProject(dir)
    setRecents(recentDirs)
    setCurrentId(current)
    setAliases(settings.projectAliases ?? {})
    // Project switch deselects the conversation (current -> null): clear the chat.
    if (current === null && prevCurrent.current !== null) {
      setLoaded((l) => ({ key: l.key + 1, messages: [] }))
    }
    prevCurrent.current = current
    const lists = await Promise.all(recentDirs.map((d) => window.api.session.list(d)))
    const grouped: Record<string, SessionMeta[]> = {}
    recentDirs.forEach((d, i) => (grouped[d] = lists[i]))
    setSessionsByProject(grouped)
  }, [])

  useEffect(() => {
    void refresh()
    const offP = window.api.project.onChange(() => void refresh())
    const offS = window.api.session.onChange(() => void refresh())
    return () => {
      offP()
      offS()
    }
  }, [refresh])

  const pickProject = useCallback(() => void window.api.project.pick(), [])

  const switchProject = useCallback((dir: string) => {
    void window.api.project.switch(dir)
  }, [])

  const newSession = useCallback(
    async (dir?: string) => {
      await window.api.session.create(dir)
      setLoaded((l) => ({ key: l.key + 1, messages: [] }))
      void refresh()
    },
    [refresh]
  )

  const selectSession = useCallback(
    async (id: string) => {
      const messages = await window.api.session.select(id)
      setCurrentId(id)
      setLoaded((l) => ({ key: l.key + 1, messages }))
      void refresh()
    },
    [refresh]
  )

  const renameSession = useCallback(
    (id: string, title: string) => {
      void window.api.session.rename(id, title).then(refresh)
    },
    [refresh]
  )

  const removeSession = useCallback(
    async (id: string) => {
      await window.api.session.remove(id)
      // Deleting the open conversation clears the chat.
      const current = await window.api.session.current()
      if (current === null) setLoaded((l) => ({ key: l.key + 1, messages: [] }))
      void refresh()
    },
    [refresh]
  )

  const forkSession = useCallback(
    async (sessionId: string, messageId: number) => {
      const newId = await window.api.session.fork(sessionId, messageId)
      if (newId) {
        const messages = await window.api.session.select(newId)
        setCurrentId(newId)
        setLoaded((l) => ({ key: l.key + 1, messages }))
      }
      void refresh()
    },
    [refresh]
  )

  const rewindSession = useCallback(
    async (sessionId: string, messageId: number) => {
      const messages = await window.api.session.rewind(sessionId, messageId)
      setLoaded((l) => ({ key: l.key + 1, messages }))
      void refresh()
    },
    [refresh]
  )

  const renameProject = useCallback(
    (dir: string, name: string) => {
      const next = { ...aliases }
      const trimmed = name.trim()
      // Renaming back to the folder name (or to nothing) clears the alias.
      if (!trimmed || trimmed === baseName(dir)) delete next[dir]
      else next[dir] = trimmed
      setAliases(next)
      void window.api.settings.set('projectAliases', next)
    },
    [aliases]
  )

  const nameOf = useCallback((dir: string) => aliases[dir] ?? baseName(dir), [aliases])

  const deselect = useCallback(async () => {
    await window.api.session.deselect()
    void refresh()
  }, [refresh])

  return {
    project,
    recents,
    sessionsByProject,
    currentId,
    loaded,
    nameOf,
    pickProject,
    switchProject,
    newSession,
    selectSession,
    renameSession,
    removeSession,
    forkSession,
    rewindSession,
    renameProject,
    deselect,
  }
}
