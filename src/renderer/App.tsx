import React, { useCallback, useEffect, useRef, useState } from 'react'
import { EngineStatus } from '../shared/types'
import { store, useProject } from './store/store'
import { clock, player } from './playback'
import { loadSource } from './source'
import { addTextLayer } from './text'
import { serializeProject, loadProjectFromJson } from './serialize'
import { TitleBar } from './components/TitleBar'
import { ToolRail } from './components/ToolRail'
import { FloatingPanel } from './components/FloatingPanel'
import { PANELS } from './components/panels'
import { DesignStage } from './components/DesignStage'
import { Timeline } from './components/Timeline'

const api = window.ggif

export function App(): JSX.Element {
  const project = useProject()
  const [platform, setPlatform] = useState<'mac' | 'win' | 'other'>('other')
  const [engine, setEngine] = useState<EngineStatus>({ connected: false, address: null, message: '' })
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<number | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [showPreview, setShowPreview] = useState(true)
  const [timelineH, setTimelineH] = useState(230)

  const onSplitter = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = timelineH
    const move = (ev: PointerEvent): void => {
      const h = startH + (startY - ev.clientY)
      setTimelineH(Math.max(140, Math.min(window.innerHeight * 0.7, h)))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [timelineH])

  // ---- boot ----
  useEffect(() => {
    api.platform().then(setPlatform)
    player.onStateChange = setPlaying
    player.onError = (m) => setError(m)
    return () => void player.stop()
  }, [])

  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      const st = await api.discoverEngine()
      if (alive) setEngine(st)
    }
    tick()
    const id = window.setInterval(tick, 4000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  // push a still frame to the OLED while paused + scrubbing
  const stillTimer = useRef<number | null>(null)
  useEffect(() => {
    if (playing || !engine.connected || project.layers.length === 0) return
    if (stillTimer.current) clearTimeout(stillTimer.current)
    stillTimer.current = window.setTimeout(() => void player.showStill(project.playhead), 90)
  }, [project.playhead, project.render, project.layers, playing, engine.connected])

  // ---- media loading ----
  const ingest = useCallback(async (files: { name: string; buffer: ArrayBuffer }[]): Promise<void> => {
    setError(null)
    setLoading(0)
    try {
      for (const f of files) {
        const src = await loadSource(f, (p) => setLoading(Math.round(p * 100)))
        store.addLayer(src)
      }
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setLoading(null)
    }
  }, [])

  const openDialog = useCallback(async (): Promise<void> => {
    const f = await api.openFile()
    if (f) await ingest([f])
  }, [ingest])

  const dropFiles = useCallback(
    async (fileList: File[]): Promise<void> => {
      const files = await Promise.all(
        fileList.map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() }))
      )
      await ingest(files)
    },
    [ingest]
  )

  // ---- transport ----
  const playStop = useCallback(async (): Promise<void> => {
    setError(null)
    if (player.isPlaying()) await player.stop()
    else {
      if (!engine.connected) {
        setError(engine.message || 'SteelSeries Engine not found')
        return
      }
      try {
        await player.start()
      } catch (e) {
        setError(String((e as Error).message ?? e))
      }
    }
  }, [engine])

  const toggle = useCallback((id: string): void => {
    setOpen((o) => ({ ...o, [id]: !o[id] }))
  }, [])

  const addText = useCallback(async (): Promise<void> => {
    await addTextLayer()
    setOpen((o) => ({ ...o, text: true }))
  }, [])

  const saveProject = useCallback(async (): Promise<void> => {
    try {
      await api.saveProject(serializeProject())
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }, [])

  const openProject = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const json = await api.openProject()
      if (json) {
        await player.stop()
        await loadProjectFromJson(json)
      }
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }, [])

  // keyboard shortcuts (ignore while typing in inputs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
      } else if (k === 'y') {
        e.preventDefault()
        store.redo()
      } else if (k === 's') {
        e.preventDefault()
        void saveProject()
      } else if (k === 'o') {
        e.preventDefault()
        void openProject()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveProject, openProject])

  return (
    <div className="app">
      <TitleBar
        title="GGIF Studio"
        platform={platform}
        onMinimize={() => api.minimize()}
        onMaximize={() => api.maximize()}
        onClose={() => api.close()}
      />

      <div className="editor">
        <ToolRail open={open} onToggle={toggle} />

        <div className="editor-main">
          <DesignStage onAddLayer={openDialog} onDropFiles={dropFiles} showPreview={showPreview} />

          <div className="transport">
            <button
              className="tbtn tbtn--primary"
              onClick={playStop}
              disabled={project.layers.length === 0}
              title={playing ? 'Stop' : 'Play'}
            >
              {playing ? (
                <svg width="16" height="16" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16"><path d="M5 3l9 5-9 5V3z" fill="currentColor" /></svg>
              )}
            </button>
            <button className="tbtn" onClick={openDialog} title="Add media">
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            </button>
            <button className="tbtn" onClick={addText} title="Add text layer">
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 4.5V3.5h10v1M8 3.5v9M6 12.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
            </button>
            <span className="tbar-sep" />
            <button className="tbtn" onClick={() => store.undo()} title="Undo (⌘Z)">
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M6 4L3 7l3 3M3 7h6.5a3.5 3.5 0 010 7H7" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button className="tbtn" onClick={() => store.redo()} title="Redo (⇧⌘Z)">
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M10 4l3 3-3 3M13 7H6.5a3.5 3.5 0 000 7H9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <span className="tbar-sep" />
            <button className="tbtn" onClick={openProject} title="Open project (⌘O)">
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 4.5A1.5 1.5 0 013.5 3h2.7l1.2 1.4h5.1A1.5 1.5 0 0114 5.9V11a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11V4.5z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" /></svg>
            </button>
            <button className="tbtn" onClick={saveProject} title="Save project (⌘S)">
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 3h7l3 3v7H3V3zM5.5 3v3h4V3M5.5 13v-4h5v4" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" /></svg>
            </button>
            <Clock />
            <label className="chk" title="Show OLED preview (turn off for max performance)">
              <input
                type="checkbox"
                checked={showPreview}
                onChange={(e) => setShowPreview(e.target.checked)}
              />
              <span>Preview</span>
            </label>
            <div className="transport__spacer" />
            {loading !== null && <span className="mono transport__note">Decoding {loading}%</span>}
            {error && <span className="error transport__note">⚠ {error}</span>}
            <span className={`status ${engine.connected ? 'ok' : 'bad'}`}>
              <span className="dot" />
              {engine.connected ? 'Engine' : 'Offline'}
            </span>
          </div>

          <div className="splitter-h" onPointerDown={onSplitter} title="Drag to resize timeline" />
          <div className="timeline-host" style={{ height: timelineH }}>
            <Timeline onAddLayer={openDialog} />
          </div>
        </div>
      </div>

      {PANELS.filter((p) => open[p.id]).map((p, i) => (
        <FloatingPanel
          key={p.id}
          title={p.title}
          initial={{ x: 80 + i * 26, y: 86 + i * 26 }}
          onClose={() => toggle(p.id)}
        >
          <p.Body />
        </FloatingPanel>
      ))}
    </div>
  )
}

/** Live transport readout (reads the clock without re-rendering the tree). */
function Clock(): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    const fmt = (ms: number): string => {
      const s = ms / 1000
      return `${s.toFixed(2)}s`
    }
    const tick = (): void => {
      const p = store.getState()
      const t = clock.playing ? clock.time : p.playhead
      if (ref.current) ref.current.textContent = `${fmt(t)} / ${fmt(p.duration)}`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <span ref={ref} className="mono transport__time">0.00s / 0.00s</span>
}
