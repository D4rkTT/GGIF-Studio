import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import {
  store,
  useProject,
  useSelectedLayer,
  getSource
} from '../store/store'
import { Layer } from '../store/types'
import { clock } from '../playback'
import { renderComposite, pixelate } from '../compositor'

/* ============================================================================
   DesignStage — center editor stage. CSS prefix: "ds-"
   Two stacked, aspect-locked canvases:
     1) DESIGN  — interactive color/grayscale composite (large)
     2) PREVIEW — the 1-bit OLED result (target-res, nearest-neighbour upscaled)
   A single rAF loop redraws both every frame from the live store. A DOM gizmo
   overlay drives move / scale / rotate on the selected layer.
   ========================================================================== */

type RGB = [number, number, number]
type DragMode = 'move' | 'scale' | 'rotate'

interface Geom {
  cssW: number // displayed CSS width of the design canvas
  cssH: number
  dpr: number
  pw: number // displayed CSS width of the OLED preview
  ph: number
}

interface DragState {
  mode: DragMode
  id: string
  startX: number // pointer client X at grab
  startY: number
  sx: number // CSS px per design px
  sy: number
  ccx: number // layer-center, client coords
  ccy: number
  startDist: number
  layer: { x: number; y: number; scale: number; rotation: number }
}

const ROTATE_ARM = 26 // px from the box top edge to the rotate handle

/* --- CSS-variable colour resolver (handles any CSS colour string) --------- */
let _probe: CanvasRenderingContext2D | null = null
function colorToRgb(value: string, fallback: string): RGB {
  if (!_probe) {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    _probe = c.getContext('2d')
  }
  const ctx = _probe
  if (!ctx) return [0, 0, 0]
  ctx.fillStyle = fallback
  ctx.fillStyle = value.trim() || fallback
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2]]
}
function readOledColors(root: HTMLElement | null): { on: RGB; off: RGB } {
  const cs = getComputedStyle(root ?? document.documentElement)
  return {
    on: colorToRgb(cs.getPropertyValue('--oled-on'), '#6ef3c5'),
    off: colorToRgb(cs.getPropertyValue('--oled-off'), '#05070a')
  }
}

function PlusIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function DesignStage(props: {
  onAddLayer(): void
  onDropFiles(files: File[]): void
  showPreview: boolean
}): JSX.Element {
  const { onAddLayer, onDropFiles, showPreview } = props
  const showPreviewRef = useRef(showPreview)
  showPreviewRef.current = showPreview
  const project = useProject()
  const sel = useSelectedLayer()
  const W = project.width
  const H = project.height
  const empty = project.layers.length === 0

  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const designCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)

  const geomRef = useRef<Geom>({ cssW: 0, cssH: 0, dpr: 1, pw: 0, ph: 0 })
  const [geom, setGeom] = useState<Geom>(geomRef.current)

  const colorRef = useRef<{ on: RGB; off: RGB }>({
    on: [110, 243, 197],
    off: [5, 7, 10]
  })
  const offRef = useRef<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null>(
    null
  )
  const outRef = useRef<ImageData | null>(null)

  const dragRef = useRef<DragState | null>(null)
  const [active, setActive] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)

  /* ---- resolve OLED phosphor colours once mounted -------------------------- */
  useEffect(() => {
    colorRef.current = readOledColors(rootRef.current)
  }, [])

  /* ---- measure available space, fit both canvases to project aspect -------- */
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const compute = (): void => {
      const vw = el.clientWidth
      const vh = el.clientHeight
      if (vw < 2 || vh < 2) return
      const gap = 16
      const labelH = 22
      const dpr = window.devicePixelRatio || 1
      let ds: number
      let ps = 0
      if (showPreview) {
        // design + preview side by side
        const previewBudgetW = Math.min(vw * 0.36, 320)
        const designBudgetW = Math.max(40, vw - previewBudgetW - gap)
        ds = Math.min(designBudgetW / W, vh / H)
        ps = Math.min(previewBudgetW / W, (vh - labelH) / H)
      } else {
        ds = Math.min(vw / W, vh / H)
      }
      const next: Geom = {
        cssW: Math.max(1, Math.round(W * ds)),
        cssH: Math.max(1, Math.round(H * ds)),
        dpr,
        pw: Math.max(1, Math.round(W * ps)),
        ph: Math.max(1, Math.round(H * ps))
      }
      geomRef.current = next
      setGeom(next)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [W, H, showPreview])

  /* ---- single render loop: design + preview, every frame ------------------- */
  useEffect(() => {
    let raf = 0
    const drawDesign = (p: typeof project, t: number): void => {
      const cv = designCanvasRef.current
      const g = geomRef.current
      if (!cv || g.cssW < 1) return
      const bw = Math.max(1, Math.round(g.cssW * g.dpr))
      const bh = Math.max(1, Math.round(g.cssH * g.dpr))
      if (cv.width !== bw) cv.width = bw
      if (cv.height !== bh) cv.height = bh
      const ctx = cv.getContext('2d')
      if (!ctx) return
      renderComposite(ctx, p, t, bw, bh)
    }

    const drawPreview = (p: typeof project, t: number): void => {
      const cv = previewCanvasRef.current
      if (!cv) return
      if (cv.width !== p.width) cv.width = p.width
      if (cv.height !== p.height) cv.height = p.height
      const ctx = cv.getContext('2d')
      if (!ctx) return

      let off = offRef.current
      if (!off || off.canvas.width !== p.width || off.canvas.height !== p.height) {
        const c = document.createElement('canvas')
        c.width = p.width
        c.height = p.height
        const octx = c.getContext('2d', { willReadFrequently: true })
        if (!octx) return
        off = { canvas: c, ctx: octx }
        offRef.current = off
      }
      renderComposite(off.ctx, p, t, p.width, p.height)
      const srcData = off.ctx.getImageData(0, 0, p.width, p.height)
      const { mono } = pixelate(srcData.data, p.width, p.height, p.render)

      let out = outRef.current
      if (!out || out.width !== p.width || out.height !== p.height) {
        out = ctx.createImageData(p.width, p.height)
        outRef.current = out
      }
      const on = colorRef.current.on
      const offc = colorRef.current.off
      const data = out.data
      for (let i = 0; i < mono.length; i++) {
        const j = i * 4
        const lit = mono[i] !== 0
        data[j] = lit ? on[0] : offc[0]
        data[j + 1] = lit ? on[1] : offc[1]
        data[j + 2] = lit ? on[2] : offc[2]
        data[j + 3] = 255
      }
      ctx.putImageData(out, 0, 0)
    }

    let lastT = -1
    let lastProj: typeof project | null = null
    let lastShow = true
    let lastGeomW = -1
    const tick = (): void => {
      const p = store.getState()
      const t = clock.playing ? clock.time : p.playhead
      const show = showPreviewRef.current
      const gw = geomRef.current.cssW
      // skip all work when nothing changed (idle) — keeps CPU near zero
      if (!clock.playing && t === lastT && p === lastProj && show === lastShow && gw === lastGeomW) {
        raf = requestAnimationFrame(tick)
        return
      }
      lastT = t
      lastProj = p
      lastShow = show
      lastGeomW = gw
      drawDesign(p, t)
      if (show) drawPreview(p, t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  /* ---- interaction: drag math runs on window so capture survives reflow ---- */
  const onPointerMoveWin = useCallback((e: PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    if (d.mode === 'move') {
      const dx = (e.clientX - d.startX) / d.sx
      const dy = (e.clientY - d.startY) / d.sy
      store.updateLayer(d.id, { x: d.layer.x + dx, y: d.layer.y + dy })
    } else if (d.mode === 'scale') {
      const cur = Math.hypot(e.clientX - d.ccx, e.clientY - d.ccy)
      store.updateLayer(d.id, {
        scale: Math.max(0.01, d.layer.scale * (cur / d.startDist))
      })
    } else {
      let ang = (Math.atan2(e.clientY - d.ccy, e.clientX - d.ccx) * 180) / Math.PI + 90
      if (e.shiftKey) ang = Math.round(ang / 15) * 15
      store.updateLayer(d.id, { rotation: ang })
    }
  }, [])

  const endDrag = useCallback((): void => {
    dragRef.current = null
    setActive(false)
    window.removeEventListener('pointermove', onPointerMoveWin)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
  }, [onPointerMoveWin])

  useEffect(() => endDrag, [endDrag])

  const beginDrag = (
    mode: DragMode,
    clientX: number,
    clientY: number,
    layer: Layer
  ): void => {
    const cv = designCanvasRef.current
    const g = geomRef.current
    if (!cv || g.cssW < 1) return
    const rect = cv.getBoundingClientRect()
    const sx = g.cssW / W
    const sy = g.cssH / H
    const ccx = rect.left + (W / 2 + layer.x) * sx
    const ccy = rect.top + (H / 2 + layer.y) * sy
    dragRef.current = {
      mode,
      id: layer.id,
      startX: clientX,
      startY: clientY,
      sx,
      sy,
      ccx,
      ccy,
      startDist: Math.max(4, Math.hypot(clientX - ccx, clientY - ccy)),
      layer: { x: layer.x, y: layer.y, scale: layer.scale, rotation: layer.rotation }
    }
    setActive(true)
    window.addEventListener('pointermove', onPointerMoveWin)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
  }

  /* ---- top-most hit test (inverse-transform into each layer's local box) --- */
  const hitTest = (clientX: number, clientY: number): string | null => {
    const cv = designCanvasRef.current
    const g = geomRef.current
    if (!cv || g.cssW < 1) return null
    const rect = cv.getBoundingClientRect()
    const lx = clientX - rect.left
    const ly = clientY - rect.top
    const sx = g.cssW / W
    const sy = g.cssH / H
    for (let i = project.layers.length - 1; i >= 0; i--) {
      const l = project.layers[i]
      if (!l.visible) continue
      const src = getSource(l.sourceId)
      if (!src) continue
      const cx = (W / 2 + l.x) * sx
      const cy = (H / 2 + l.y) * sy
      const dx = lx - cx
      const dy = ly - cy
      const rad = (-l.rotation * Math.PI) / 180
      const c = Math.cos(rad)
      const s = Math.sin(rad)
      const rxc = dx * c - dy * s
      const ryc = dx * s + dy * c
      const halfW = (src.width * l.scale * sx) / 2
      const halfH = (src.height * l.scale * sy) / 2
      if (Math.abs(rxc) <= halfW && Math.abs(ryc) <= halfH) return l.id
    }
    return null
  }

  const onOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const id = hitTest(e.clientX, e.clientY)
    store.select(id)
    if (id) {
      const l = project.layers.find((x) => x.id === id)
      if (l && !l.locked) beginDrag('move', e.clientX, e.clientY, l)
    }
  }

  const onHandlePointerDown = (
    mode: DragMode,
    e: React.PointerEvent<HTMLDivElement>
  ): void => {
    if (e.button !== 0 || !sel) return
    e.preventDefault()
    e.stopPropagation()
    beginDrag(mode, e.clientX, e.clientY, sel)
  }

  /* ---- drag-drop of media files ------------------------------------------- */
  const onDragEnter = (e: React.DragEvent): void => {
    e.preventDefault()
    dragDepth.current += 1
    setDragOver(true)
  }
  const onDragOverEvt = (e: React.DragEvent): void => {
    e.preventDefault()
  }
  const onDragLeave = (e: React.DragEvent): void => {
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : []
    if (files.length) onDropFiles(files)
  }

  /* ---- gizmo geometry (CSS px, axis-aligned in the layer's rotated frame) -- */
  const sx = W > 0 ? geom.cssW / W : 0
  const sy = H > 0 ? geom.cssH / H : 0
  const selSrc = sel ? getSource(sel.sourceId) : undefined
  let gizmo:
    | { cx: number; cy: number; hw: number; hh: number; rot: number; locked: boolean }
    | null = null
  if (sel && selSrc && geom.cssW > 0) {
    gizmo = {
      cx: (W / 2 + sel.x) * sx,
      cy: (H / 2 + sel.y) * sy,
      hw: (selSrc.width * sel.scale * sx) / 2,
      hh: (selSrc.height * sel.scale * sy) / 2,
      rot: sel.rotation,
      locked: sel.locked
    }
  }

  const handlePts = gizmo
    ? [
        { k: 'nw', x: -gizmo.hw, y: -gizmo.hh, edge: false },
        { k: 'n', x: 0, y: -gizmo.hh, edge: true },
        { k: 'ne', x: gizmo.hw, y: -gizmo.hh, edge: false },
        { k: 'e', x: gizmo.hw, y: 0, edge: true },
        { k: 'se', x: gizmo.hw, y: gizmo.hh, edge: false },
        { k: 's', x: 0, y: gizmo.hh, edge: true },
        { k: 'sw', x: -gizmo.hw, y: gizmo.hh, edge: false },
        { k: 'w', x: -gizmo.hw, y: 0, edge: true }
      ]
    : []

  return (
    <div
      ref={rootRef}
      className={`ds-stage ${dragOver ? 'is-drag' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOverEvt}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div ref={viewportRef} className="ds-viewport">
        <div
          className="ds-design-area"
          style={{ width: geom.cssW, height: geom.cssH }}
        >
          <canvas ref={designCanvasRef} className="ds-design-canvas" />

          <div
            className={`ds-overlay ${active ? 'is-grabbing' : ''}`}
            onPointerDown={onOverlayPointerDown}
          >
            {gizmo && (
              <div
                className="ds-gizmo"
                style={{
                  left: gizmo.cx,
                  top: gizmo.cy,
                  transform: `rotate(${gizmo.rot}deg)`
                }}
              >
                <div
                  className="ds-box"
                  style={{
                    left: -gizmo.hw,
                    top: -gizmo.hh,
                    width: gizmo.hw * 2,
                    height: gizmo.hh * 2
                  }}
                />
                {!gizmo.locked && (
                  <>
                    <div
                      className="ds-rotate-line"
                      style={{ top: -gizmo.hh - ROTATE_ARM, height: ROTATE_ARM }}
                    />
                    <div
                      className="ds-rotate"
                      style={{ left: 0, top: -gizmo.hh - ROTATE_ARM }}
                      onPointerDown={(e) => onHandlePointerDown('rotate', e)}
                    />
                    {handlePts.map((h) => (
                      <div
                        key={h.k}
                        className={`ds-handle ${h.edge ? 'ds-handle--edge' : ''}`}
                        style={{ left: h.x, top: h.y }}
                        onPointerDown={(e) => onHandlePointerDown('scale', e)}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {empty && (
            <button
              type="button"
              className="ds-empty"
              onClick={onAddLayer}
              onDragEnter={onDragEnter}
            >
              <span className="ds-empty__icon">
                <PlusIcon />
              </span>
              <span className="ds-empty__text">Add media</span>
              <span className="ds-empty__hint">
                Drop a GIF, video, or image — or click to browse
              </span>
            </button>
          )}
        </div>

        <div className="ds-preview-area" style={{ display: showPreview ? undefined : 'none' }}>
          <div className="ds-preview-label">
            <span className="ds-preview-dot" />
            OLED Preview
            <em>
              {W}×{H}
            </em>
          </div>
          <canvas
            ref={previewCanvasRef}
            className="ds-preview-canvas"
            style={{ width: geom.pw, height: geom.ph }}
          />
        </div>
      </div>

      {dragOver && <div className="ds-dropveil">Drop media to add a layer</div>}
    </div>
  )
}
