import { store, getSource, putSource } from './store/store'
import { Project } from './store/types'
import { loadSource } from './source'
import { makeTextSource } from './text'

const FORMAT = 'ggif-project'
const VERSION = 1

function abToB64(buf: ArrayBuffer): string {
  let s = ''
  const b = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < b.length; i += chunk) {
    s += String.fromCharCode(...b.subarray(i, i + chunk))
  }
  return btoa(s)
}

function b64ToAb(s: string): ArrayBuffer {
  const bin = atob(s)
  const b = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
  return b.buffer
}

interface SavedSource {
  id: string
  name: string
  kind: string
  bytes?: string // base64 (media only)
}

/** Serialize the current project (+ embedded media) to a JSON string. */
export function serializeProject(): string {
  const project = store.getState()
  const ids = new Set(project.layers.map((l) => l.sourceId))
  const sources: SavedSource[] = []
  for (const id of ids) {
    const src = getSource(id)
    if (!src) continue
    if (src.kind === 'text') {
      sources.push({ id, name: src.name, kind: 'text' }) // regenerated from layer.text
    } else if (src.bytes) {
      sources.push({ id, name: src.name, kind: src.kind, bytes: abToB64(src.bytes) })
    }
  }
  const { ...proj } = project
  return JSON.stringify({ format: FORMAT, version: VERSION, project: proj, sources })
}

/** Load a project JSON string: rebuild sources, regenerate text, swap state. */
export async function loadProjectFromJson(json: string): Promise<void> {
  const data = JSON.parse(json)
  if (data.format !== FORMAT) throw new Error('Not a GGIF project file')
  const project = data.project as Project
  const saved: SavedSource[] = data.sources ?? []

  // rebuild media sources, preserving their original ids so layers still match
  for (const s of saved) {
    if (s.kind === 'text' || !s.bytes) continue
    const buf = b64ToAb(s.bytes)
    const src = await loadSource({ name: s.name, buffer: buf })
    src.id = s.id
    src.bytes = buf
    putSource(src)
  }

  // regenerate text layers from their stored spec (new bitmap source ids)
  for (const layer of project.layers) {
    if (layer.kind === 'text' && layer.text) {
      const src = await makeTextSource(layer.text)
      putSource(src)
      layer.sourceId = src.id
    }
    if (typeof layer.len !== 'number') layer.len = layer.out - layer.in // legacy
  }

  store.loadProject(project)
}
