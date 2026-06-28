import React, { useCallback, useEffect, useRef, useState } from 'react'
import { store, useProject } from '../store/store'
import { Layer } from '../store/types'
import { clock } from '../playback'

/* After Effects–style multi-track timeline. CSS prefix: "tl-".
   Left fixed header column + right horizontally-scrollable track area with a
   time ruler. Tracks render TOP-DOWN in reverse z-order (top-most layer =
   project.layers[last] in the top row). Playhead follows clock.time via rAF. */

const HEAD_W = 180
const ROW_H = 46
const RULER_H = 30
const MIN_PPM = 0.01
const MAX_PPM = 1.5
const MIN_CLIP_MS = 50

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n
}

/** Pick a "nice" tick spacing (ms) so labels land roughly `targetPx` apart. */
function niceInterval(targetMs: number): number {
  const steps = [
    50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000,
    120000, 300000, 600000
  ]
  for (const s of steps) if (s >= targetMs) return s
  return steps[steps.length - 1]
}

function fmtTime(ms: number, interval: number): string {
  const s = ms / 1000
  if (interval >= 1000) return `${s.toFixed(0)}s`
  if (interval >= 250) return `${s.toFixed(1)}s`
  return `${s.toFixed(2)}s`
}

/** Attach transient window listeners for a pointer drag. */
function beginDrag(onMove: (e: PointerEvent) => void, onUp?: () => void): void {
  const move = (e: PointerEvent): void => onMove(e)
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    onUp?.()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

/* ---------------------------------------------------------------- icons --- */

function IconEye({ off }: { off: boolean }): JSX.Element {
  return off ? (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M2 2L14 14M6.5 6.6A2 2 0 0 0 9.4 9.5M4.2 4.4C2.7 5.3 1.6 6.7 1 8c1.2 2.6 3.9 4.5 7 4.5 1.1 0 2.2-.25 3.1-.7M7 3.6c.33-.06.66-.1 1-.1 3.1 0 5.8 1.9 7 4.5-.5 1-1.2 2-2.1 2.7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M1 8c1.2-2.6 3.9-4.5 7-4.5s5.8 1.9 7 4.5c-1.2 2.6-3.9 4.5-7 4.5S2.2 10.6 1 8Z"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  )
}

function IconLock({ open }: { open: boolean }): JSX.Element {
  return open ? (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.6" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function IconChevron({ up }: { up: boolean }): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path
        d={up ? 'M3 7.5L6 4.5L9 7.5' : 'M3 4.5L6 7.5L9 4.5'}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function IconTrash(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M3 4.5h10M6.5 4.5V3.2c0-.4.3-.7.7-.7h1.6c.4 0 .7.3.7.7v1.3M4.5 4.5l.5 8c0 .5.4.9.9.9h4.2c.5 0 .9-.4.9-.9l.5-8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function IconPlus(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconMinus(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M3.2 8h9.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/* --------------------------------------------------------- track header --- */

function TrackHeader({
  layer,
  z,
  total,
  selected
}: {
  layer: Layer
  z: number
  total: number
  selected: boolean
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(layer.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const startEdit = (): void => {
    setDraft(layer.name)
    setEditing(true)
  }
  const commit = (): void => {
    const name = draft.trim()
    if (name && name !== layer.name) store.updateLayer(layer.id, { name })
    setEditing(false)
  }

  const stop = (e: React.MouseEvent): void => e.stopPropagation()

  return (
    <div
      className={`tl-track-head ${selected ? 'is-selected' : ''}`}
      onClick={() => store.select(layer.id)}
    >
      <button
        type="button"
        className={`tl-icon-btn ${layer.visible ? '' : 'is-off'}`}
        title={layer.visible ? 'Hide layer' : 'Show layer'}
        aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
        onClick={(e) => {
          stop(e)
          store.updateLayer(layer.id, { visible: !layer.visible })
        }}
      >
        <IconEye off={!layer.visible} />
      </button>

      {editing ? (
        <input
          ref={inputRef}
          className="tl-name-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={stop}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span
          className="tl-track-name"
          title={layer.name}
          onDoubleClick={(e) => {
            stop(e)
            startEdit()
          }}
        >
          {layer.name}
        </span>
      )}

      <div className="tl-track-actions">
        <button
          type="button"
          className={`tl-icon-btn ${layer.locked ? 'is-on' : ''}`}
          title={layer.locked ? 'Unlock' : 'Lock'}
          aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'}
          onClick={(e) => {
            stop(e)
            store.updateLayer(layer.id, { locked: !layer.locked })
          }}
        >
          <IconLock open={!layer.locked} />
        </button>
        <button
          type="button"
          className="tl-icon-btn"
          title="Move up"
          aria-label="Move layer up"
          disabled={z >= total - 1}
          onClick={(e) => {
            stop(e)
            store.reorder(layer.id, 1)
          }}
        >
          <IconChevron up />
        </button>
        <button
          type="button"
          className="tl-icon-btn"
          title="Move down"
          aria-label="Move layer down"
          disabled={z <= 0}
          onClick={(e) => {
            stop(e)
            store.reorder(layer.id, -1)
          }}
        >
          <IconChevron up={false} />
        </button>
        <button
          type="button"
          className="tl-icon-btn tl-icon-btn--danger"
          title="Delete layer"
          aria-label="Delete layer"
          onClick={(e) => {
            stop(e)
            store.removeLayer(layer.id)
          }}
        >
          <IconTrash />
        </button>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- clip ----- */

function Clip({
  layer,
  selected,
  pxPerMsRef
}: {
  layer: Layer
  selected: boolean
  pxPerMsRef: React.MutableRefObject<number>
}): JSX.Element {
  const ppm = pxPerMsRef.current
  const left = layer.start * ppm
  // On-timeline length is layer.len, INDEPENDENT of the trimmed source span.
  const width = Math.max(2, layer.len * ppm)

  // Drag the clip BODY → move its start position (cannot go negative).
  const onBodyDown = (e: React.PointerEvent): void => {
    e.stopPropagation()
    store.select(layer.id)
    if (layer.locked) return
    const startX = e.clientX
    const startStart = layer.start
    const scale = pxPerMsRef.current
    beginDrag((ev) => {
      const dMs = (ev.clientX - startX) / scale
      store.updateLayer(layer.id, { start: Math.max(0, Math.round(startStart + dMs)) })
    })
  }

  // Drag the LEFT edge → trim the in-point while pinning the clip's RIGHT edge.
  // start += delta and len -= delta so the right edge stays fixed.
  const onLeftDown = (e: React.PointerEvent): void => {
    e.stopPropagation()
    store.select(layer.id)
    if (layer.locked) return
    const startX = e.clientX
    const sIn = layer.in
    const sStart = layer.start
    const sLen = layer.len
    const out = layer.out
    const scale = pxPerMsRef.current
    beginDrag((ev) => {
      const dMs = (ev.clientX - startX) / scale
      // in is bounded by [0, out - 1]; also cap so len never drops below the min.
      const maxDelta = sLen - MIN_CLIP_MS
      const newIn = clamp(Math.round(sIn + dMs), 0, Math.min(out - 1, sIn + maxDelta))
      const delta = newIn - sIn
      store.updateLayer(layer.id, {
        in: newIn,
        start: Math.max(0, Math.round(sStart + delta)),
        len: Math.max(MIN_CLIP_MS, sLen - delta)
      })
    })
  }

  // Drag the RIGHT edge → change the clip length. NO upper clamp: len may
  // exceed the source span (the compositor loops the source to fill).
  const onRightDown = (e: React.PointerEvent): void => {
    e.stopPropagation()
    store.select(layer.id)
    if (layer.locked) return
    const startX = e.clientX
    const sLen = layer.len
    const scale = pxPerMsRef.current
    beginDrag((ev) => {
      const dMs = (ev.clientX - startX) / scale
      store.updateLayer(layer.id, { len: Math.max(MIN_CLIP_MS, Math.round(sLen + dMs)) })
    })
  }

  // Loop separators: when the clip is longer than its trimmed source span, draw
  // faint vertical lines at each loop boundary so the tiling is visible.
  const span = layer.out - layer.in
  const loops: number[] = []
  if (span > 0 && layer.len > span) {
    for (let i = 1; i * span < layer.len; i++) loops.push(i * span * ppm)
  }

  return (
    <div
      className={`tl-clip ${selected ? 'is-selected' : ''} ${layer.locked ? 'is-locked' : ''}`}
      style={{ left: `${left}px`, width: `${width}px` }}
      onPointerDown={onBodyDown}
    >
      <span className="tl-clip__edge tl-clip__edge--l" onPointerDown={onLeftDown} aria-hidden />
      {loops.map((x, i) => (
        <span key={i} className="tl-clip__loop" style={{ left: `${x}px` }} aria-hidden />
      ))}
      <span className="tl-clip__label">{layer.name}</span>
      <span className="tl-clip__edge tl-clip__edge--r" onPointerDown={onRightDown} aria-hidden />
    </div>
  )
}

/* ------------------------------------------------------------ timeline ---- */

export function Timeline(props: { onAddLayer(): void }): JSX.Element {
  const project = useProject()
  const [pxPerMs, setPxPerMs] = useState(0.06)
  const pxPerMsRef = useRef(pxPerMs)
  pxPerMsRef.current = pxPerMs

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const rulerContentRef = useRef<HTMLDivElement>(null)
  const headersInnerRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const rulerHeadRef = useRef<HTMLDivElement>(null)

  // Playhead follows the transport clock without re-rendering React.
  useEffect(() => {
    let raf = 0
    const loop = (): void => {
      const x = clock.time * pxPerMsRef.current
      const t = `translateX(${x}px)`
      if (playheadRef.current) playheadRef.current.style.transform = t
      if (rulerHeadRef.current) rulerHeadRef.current.style.transform = t
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Keep the ruler + header columns aligned with the track scroll position.
  const onTracksScroll = useCallback((e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    if (rulerContentRef.current)
      rulerContentRef.current.style.transform = `translateX(${-el.scrollLeft}px)`
    if (headersInnerRef.current)
      headersInnerRef.current.style.transform = `translateY(${-el.scrollTop}px)`
  }, [])

  // Move the playhead from a client X coordinate (ruler or track-area scrub).
  const scrubTo = useCallback((clientX: number): void => {
    const content = contentRef.current
    if (!content) return
    const rect = content.getBoundingClientRect()
    const ms = (clientX - rect.left) / pxPerMsRef.current
    const t = clamp(ms, 0, store.getState().duration)
    clock.time = t
    store.setPlayhead(t)
  }, [])

  const onScrubDown = useCallback(
    (e: React.PointerEvent): void => {
      scrubTo(e.clientX)
      beginDrag((ev) => scrubTo(ev.clientX))
    },
    [scrubTo]
  )

  // ctrl/cmd + wheel zoom, anchored at the cursor.
  const zoomAt = useCallback((clientX: number, factor: number): void => {
    const content = contentRef.current
    const scroll = scrollRef.current
    const prev = pxPerMsRef.current
    const next = clamp(prev * factor, MIN_PPM, MAX_PPM)
    if (next === prev) return
    let msAtCursor = 0
    let viewportX = 0
    if (content && scroll) {
      msAtCursor = (clientX - content.getBoundingClientRect().left) / prev
      viewportX = clientX - scroll.getBoundingClientRect().left
    }
    setPxPerMs(next)
    if (scroll) {
      requestAnimationFrame(() => {
        scroll.scrollLeft = Math.max(0, msAtCursor * next - viewportX)
        if (rulerContentRef.current)
          rulerContentRef.current.style.transform = `translateX(${-scroll.scrollLeft}px)`
      })
    }
  }, [])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      zoomAt(e.clientX, Math.exp(-e.deltaY * 0.0015))
    }
    scroll.addEventListener('wheel', onWheel, { passive: false })
    return () => scroll.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const zoomButton = (factor: number): void => {
    const s = scrollRef.current
    const cx = s ? s.getBoundingClientRect().left + s.clientWidth / 2 : 0
    zoomAt(cx, factor)
  }

  // Geometry.
  const interval = niceInterval(78 / pxPerMs)
  const totalMs = Math.max(project.duration, 4000) + interval * 2
  const contentW = totalMs * pxPerMs

  const ticks: { ms: number; major: boolean }[] = []
  for (let ms = 0; ms <= totalMs + 1; ms += interval / 2) {
    ticks.push({ ms, major: Math.round(ms / (interval / 2)) % 2 === 0 })
  }

  // Top-down, reverse z-order: top row = highest layer index.
  const ordered = project.layers
    .map((layer, z) => ({ layer, z }))
    .reverse()
  const total = project.layers.length

  const toolbar = (
    <div className="tl-toolbar">
      <span className="tl-toolbar__title">Timeline</span>
      <span className="tl-spacer" />
      <div className="tl-zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          className="tl-icon-btn"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => zoomButton(0.77)}
        >
          <IconMinus />
        </button>
        <span className="tl-zoom__val">{Math.round(pxPerMs * 1000)} px/s</span>
        <button
          type="button"
          className="tl-icon-btn"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => zoomButton(1.3)}
        >
          <IconPlus />
        </button>
      </div>
      <button type="button" className="btn primary tl-add" onClick={props.onAddLayer}>
        <IconPlus />
        Add layer
      </button>
    </div>
  )

  if (total === 0) {
    return (
      <div className="tl">
        {toolbar}
        <div className="tl-empty">
          <p className="tl-empty__lead">No layers yet</p>
          <p className="tl-empty__sub">Drop in a GIF, video or image to start animating.</p>
          <button type="button" className="btn primary" onClick={props.onAddLayer}>
            <IconPlus />
            Add layer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="tl">
      {toolbar}
      <div className="tl-body">
        <div className="tl-left">
          <div className="tl-corner" />
          <div className="tl-headers">
            <div className="tl-headers-inner" ref={headersInnerRef}>
              {ordered.map(({ layer, z }) => (
                <TrackHeader
                  key={layer.id}
                  layer={layer}
                  z={z}
                  total={total}
                  selected={layer.id === project.selectedId}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="tl-right">
          <div className="tl-ruler-scroll">
            <div
              className="tl-ruler-content"
              ref={rulerContentRef}
              style={{ width: `${contentW}px` }}
              onPointerDown={onScrubDown}
            >
              {ticks.map((t, i) => {
                const x = t.ms * pxPerMs
                return (
                  <div
                    key={i}
                    className={`tl-tick ${t.major ? '' : 'tl-tick--minor'}`}
                    style={{ left: `${x}px` }}
                  >
                    {t.major && <span className="tl-tick__label">{fmtTime(t.ms, interval)}</span>}
                  </div>
                )
              })}
              <div className="tl-ruler-head" ref={rulerHeadRef} />
            </div>
          </div>

          <div className="tl-tracks-scroll scroll" ref={scrollRef} onScroll={onTracksScroll}>
            <div className="tl-content" ref={contentRef} style={{ width: `${contentW}px` }} onPointerDown={onScrubDown}>
              {ordered.map(({ layer }) => (
                <div
                  key={layer.id}
                  className={`tl-row ${layer.id === project.selectedId ? 'is-selected' : ''}`}
                >
                  <Clip
                    layer={layer}
                    selected={layer.id === project.selectedId}
                    pxPerMsRef={pxPerMsRef}
                  />
                </div>
              ))}
              <div className="tl-playhead" ref={playheadRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
