import { useSyncExternalStore } from 'react'
import {
  Layer,
  Project,
  RenderSettings,
  SourceData,
  emptyProject
} from './types'

// Decoded media lives outside the reactive tree (holds ImageBitmaps).
const sources = new Map<string, SourceData>()
export function putSource(s: SourceData): void {
  sources.set(s.id, s)
}
export function getSource(id: string): SourceData | undefined {
  return sources.get(id)
}

let _id = 0
export function uid(prefix = 'l'): string {
  _id += 1
  return `${prefix}${_id.toString(36)}${(performance.now() | 0).toString(36)}`
}

function recalcDuration(p: Project): number {
  if (p.layers.length === 0) return 3000 // empty project placeholder
  let end = 0
  for (const l of p.layers) end = Math.max(end, l.start + l.len) // len = clip length
  return Math.max(1, Math.ceil(end)) // exact content end — no padding
}

class Store {
  private state: Project = emptyProject()
  private listeners = new Set<() => void>()

  getState = (): Project => this.state
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    for (const l of this.listeners) l()
  }

  // undo/redo history of full project snapshots (geometry/render edits only)
  private undoStack: Project[] = []
  private redoStack: Project[] = []
  private readonly HISTORY_MAX = 100

  /** @param history push current state onto the undo stack first (default true) */
  private commit(next: Project, history = true): void {
    next.duration = recalcDuration(next)
    if (history) {
      this.undoStack.push(this.state)
      if (this.undoStack.length > this.HISTORY_MAX) this.undoStack.shift()
      this.redoStack = []
    }
    this.state = next
    this.emit()
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }
  canRedo(): boolean {
    return this.redoStack.length > 0
  }
  undo(): void {
    const prev = this.undoStack.pop()
    if (!prev) return
    this.redoStack.push(this.state)
    this.state = prev
    this.emit()
  }
  redo(): void {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(this.state)
    this.state = next
    this.emit()
  }

  /** Replace the whole project (loading a file). Clears history. */
  loadProject(p: Project): void {
    this.undoStack = []
    this.redoStack = []
    this.state = { ...p, duration: recalcDuration(p) }
    this.emit()
  }

  set(patch: Partial<Project>): void {
    this.commit({ ...this.state, ...patch })
  }

  setRender(patch: Partial<RenderSettings>): void {
    this.commit({ ...this.state, render: { ...this.state.render, ...patch } })
  }

  addLayer(
    source: SourceData,
    opts?: { text?: import('./types').TextSpec; scale?: number; len?: number }
  ): string {
    putSource(source)
    const id = uid()
    const fit = Math.min(this.state.width / source.width, this.state.height / source.height)
    const scale = opts?.scale ?? (fit > 0 && isFinite(fit) ? fit : 1)
    const len = opts?.len ?? source.durationMs
    const layer: Layer = {
      id,
      name: opts?.text ? opts.text.content.slice(0, 24) || 'Text' : source.name,
      sourceId: source.id,
      kind: source.kind,
      start: 0,
      in: 0,
      out: source.durationMs,
      len,
      text: opts?.text,
      x: 0,
      y: 0,
      scale,
      rotation: 0,
      opacity: 1,
      flipH: false,
      flipV: false,
      visible: true,
      locked: false
    }
    this.commit({
      ...this.state,
      layers: [...this.state.layers, layer],
      selectedId: id
    })
    return id
  }

  /** Swap a layer's underlying source (text re-render) — same id, no history. */
  setLayerSource(id: string, source: SourceData, patch?: Partial<Layer>): void {
    putSource(source)
    this.commit(
      {
        ...this.state,
        layers: this.state.layers.map((l) =>
          l.id === id ? { ...l, sourceId: source.id, ...patch } : l
        )
      },
      false
    )
  }

  updateLayer(id: string, patch: Partial<Layer>): void {
    this.commit({
      ...this.state,
      layers: this.state.layers.map((l) => (l.id === id ? { ...l, ...patch } : l))
    })
  }

  removeLayer(id: string): void {
    const layers = this.state.layers.filter((l) => l.id !== id)
    this.commit({
      ...this.state,
      layers,
      selectedId: this.state.selectedId === id ? (layers[layers.length - 1]?.id ?? null) : this.state.selectedId
    })
  }

  /** Move a layer in z-order. dir -1 = down, +1 = up. */
  reorder(id: string, dir: number): void {
    const arr = [...this.state.layers]
    const i = arr.findIndex((l) => l.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    this.commit({ ...this.state, layers: arr })
  }

  select(id: string | null): void {
    if (id === this.state.selectedId) return
    this.commit({ ...this.state, selectedId: id }, false)
  }

  setPlayhead(ms: number): void {
    const t = Math.max(0, Math.min(ms, this.state.duration))
    if (t === this.state.playhead) return
    this.commit({ ...this.state, playhead: t }, false)
  }
}

export const store = new Store()

export function useProject(): Project {
  return useSyncExternalStore(store.subscribe, store.getState)
}

export function useSelectedLayer(): Layer | null {
  const p = useProject()
  return p.layers.find((l) => l.id === p.selectedId) ?? null
}
