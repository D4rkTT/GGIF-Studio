import React from 'react'
import { store, useProject, useSelectedLayer, getSource } from '../../store/store'
import { BgFill, DitherMode, TextAlign, FONT_FAMILIES } from '../../store/types'
import { updateTextLayer } from '../../text'
import { RESOLUTIONS } from '../../../shared/types'
import { Slider } from '../Slider'
import { Switch } from '../Switch'
import { Segmented } from '../Segmented'
import { Dropdown } from '../Dropdown'
import { Field } from '../Field'

/* ============================================================================
   Shared bits
   ========================================================================== */

function EmptyState({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="fp-empty">{children}</div>
}

/* ============================================================================
   Transform — selected layer geometry
   ========================================================================== */

const TransformPanel: React.FC = () => {
  const project = useProject()
  const layer = useSelectedLayer()
  if (!layer) return <EmptyState>Select a layer</EmptyState>

  const bx = Math.max(64, project.width)
  const by = Math.max(64, project.height)
  return (
    <div className="fp-stack">
      <Slider
        label="X"
        value={layer.x}
        min={-bx}
        max={bx}
        step={1}
        unit="px"
        bipolar
        onChange={(v) => store.updateLayer(layer.id, { x: v })}
      />
      <Slider
        label="Y"
        value={layer.y}
        min={-by}
        max={by}
        step={1}
        unit="px"
        bipolar
        onChange={(v) => store.updateLayer(layer.id, { y: v })}
      />
      <Slider
        label="Scale"
        value={layer.scale}
        min={0.05}
        max={5}
        step={0.01}
        unit="×"
        onChange={(v) => store.updateLayer(layer.id, { scale: v })}
      />
      <Slider
        label="Rotation"
        value={layer.rotation}
        min={-180}
        max={180}
        step={1}
        unit="°"
        bipolar
        onChange={(v) => store.updateLayer(layer.id, { rotation: v })}
      />
      <Slider
        label="Opacity"
        value={layer.opacity}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => store.updateLayer(layer.id, { opacity: v })}
      />
      <Field label="Flip H">
        <Switch checked={layer.flipH} onChange={(v) => store.updateLayer(layer.id, { flipH: v })} />
      </Field>
      <Field label="Flip V">
        <Switch checked={layer.flipV} onChange={(v) => store.updateLayer(layer.id, { flipV: v })} />
      </Field>
    </div>
  )
}

/* ============================================================================
   Source — name, trim, start
   ========================================================================== */

const SourcePanel: React.FC = () => {
  const project = useProject()
  const layer = useSelectedLayer()
  if (!layer) return <EmptyState>Select a layer</EmptyState>

  const src = getSource(layer.sourceId)
  const dur = Math.max(1, src?.durationMs ?? layer.out)
  const maxStart = Math.max(2000, project.duration)

  return (
    <div className="fp-stack">
      <Field label="Name">
        <input
          className="fp-input"
          type="text"
          value={layer.name}
          spellCheck={false}
          onChange={(e) => store.updateLayer(layer.id, { name: e.target.value })}
        />
      </Field>
      <Slider
        label="Trim In"
        value={layer.in}
        min={0}
        max={dur}
        step={1}
        unit="ms"
        onChange={(v) => store.updateLayer(layer.id, { in: Math.min(v, layer.out - 1) })}
      />
      <Slider
        label="Trim Out"
        value={layer.out}
        min={0}
        max={dur}
        step={1}
        unit="ms"
        onChange={(v) => store.updateLayer(layer.id, { out: Math.max(v, layer.in + 1) })}
      />
      <Slider
        label="Start"
        value={layer.start}
        min={0}
        max={maxStart}
        step={10}
        unit="ms"
        onChange={(v) => store.updateLayer(layer.id, { start: v })}
      />
    </div>
  )
}

/* ============================================================================
   Tone — global 1-bit conditioning
   ========================================================================== */

const TonePanel: React.FC = () => {
  const { render } = useProject()
  return (
    <div className="fp-stack">
      <Slider
        label="Brightness"
        value={render.brightness}
        min={-100}
        max={100}
        step={1}
        bipolar
        onChange={(v) => store.setRender({ brightness: v })}
      />
      <Slider
        label="Contrast"
        value={render.contrast}
        min={-100}
        max={100}
        step={1}
        bipolar
        onChange={(v) => store.setRender({ contrast: v })}
      />
      <Slider
        label="Gamma"
        value={render.gamma}
        min={0.1}
        max={3}
        step={0.01}
        onChange={(v) => store.setRender({ gamma: v })}
      />
      <Field label="Normalize" hint="auto levels">
        <Switch checked={render.normalize} onChange={(v) => store.setRender({ normalize: v })} />
      </Field>
      <Slider
        label="Threshold"
        value={render.threshold}
        min={0}
        max={255}
        step={1}
        onChange={(v) => store.setRender({ threshold: v })}
      />
    </div>
  )
}

/* ============================================================================
   Output — dither / invert / background
   ========================================================================== */

const DITHER_OPTIONS: { value: DitherMode; label: string }[] = [
  { value: 'floyd-steinberg', label: 'Floyd–Steinberg' },
  { value: 'atkinson', label: 'Atkinson' },
  { value: 'ordered', label: 'Ordered (Bayer)' },
  { value: 'threshold', label: 'Threshold' },
  { value: 'none', label: 'None' }
]

const BG_OPTIONS = [
  { value: 'black', label: 'Black' },
  { value: 'white', label: 'White' }
]

const OutputPanel: React.FC = () => {
  const { render } = useProject()
  return (
    <div className="fp-stack">
      <Field label="Dither">
        <Dropdown
          value={render.dither}
          options={DITHER_OPTIONS}
          onChange={(v) => store.setRender({ dither: v as DitherMode })}
        />
      </Field>
      <Field label="Invert" hint="flip final 1-bit">
        <Switch checked={render.invert} onChange={(v) => store.setRender({ invert: v })} />
      </Field>
      <Field label="Background">
        <Segmented
          value={render.bgFill}
          options={BG_OPTIONS}
          onChange={(v) => store.setRender({ bgFill: v as BgFill })}
        />
      </Field>
    </div>
  )
}

/* ============================================================================
   Project — canvas + transport
   ========================================================================== */

const RES_OPTIONS = RESOLUTIONS.map((r) => ({ value: `${r.w}x${r.h}`, label: r.label }))

const ProjectPanel: React.FC = () => {
  const project = useProject()
  const resValue = `${project.width}x${project.height}`
  return (
    <div className="fp-stack">
      <Field label="Resolution">
        <Dropdown
          value={resValue}
          options={RES_OPTIONS}
          onChange={(v) => {
            const [w, h] = v.split('x').map((n) => parseInt(n, 10))
            if (Number.isFinite(w) && Number.isFinite(h)) store.set({ width: w, height: h })
          }}
        />
      </Field>
      <Slider
        label="FPS"
        value={project.fps}
        min={1}
        max={60}
        step={1}
        onChange={(v) => store.set({ fps: v })}
      />
      <Slider
        label="Speed"
        value={project.speed}
        min={0.1}
        max={5}
        step={0.1}
        unit="×"
        onChange={(v) => store.set({ speed: v })}
      />
      <Field label="Loop">
        <Switch checked={project.loop} onChange={(v) => store.set({ loop: v })} />
      </Field>
      <Slider
        label="Min Frame"
        value={project.minFrameMs}
        min={0}
        max={200}
        step={1}
        unit="ms"
        onChange={(v) => store.set({ minFrameMs: v })}
      />
    </div>
  )
}

/* ============================================================================
   Layers — z-ordered list (mirrors timeline headers)
   ========================================================================== */

const LayersPanel: React.FC = () => {
  const project = useProject()
  if (project.layers.length === 0) return <EmptyState>No layers yet</EmptyState>

  // Top of the visual stack (highest z) first.
  const ordered = project.layers.slice().reverse()
  const count = project.layers.length

  return (
    <div className="fp-layers">
      {ordered.map((layer) => {
        const z = project.layers.findIndex((l) => l.id === layer.id)
        const selected = layer.id === project.selectedId
        return (
          <div
            key={layer.id}
            className={`fp-layer ${selected ? 'is-selected' : ''}`}
            onPointerDown={() => store.select(layer.id)}
          >
            <button
              type="button"
              className={`fp-lbtn ${layer.visible ? 'is-on' : ''}`}
              title={layer.visible ? 'Hide' : 'Show'}
              onClick={(e) => {
                e.stopPropagation()
                store.updateLayer(layer.id, { visible: !layer.visible })
              }}
            >
              {layer.visible ? (
                <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
                  <path
                    d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    fill="none"
                  />
                  <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
                  <path
                    d="M2 8S4.5 4 8 4M14 8S13 9.6 11 10.8M2.5 2.5l11 11"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              )}
            </button>

            <button
              type="button"
              className={`fp-lbtn ${layer.locked ? 'is-on' : ''}`}
              title={layer.locked ? 'Unlock' : 'Lock'}
              onClick={(e) => {
                e.stopPropagation()
                store.updateLayer(layer.id, { locked: !layer.locked })
              }}
            >
              {layer.locked ? (
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                  <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" fill="none" />
                  <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" fill="none" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                  <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" fill="none" />
                  <path d="M5.5 7V5a2.5 2.5 0 014.9-.7" stroke="currentColor" strokeWidth="1.3" fill="none" />
                </svg>
              )}
            </button>

            <span className="fp-layer-name">{layer.name}</span>

            <div className="fp-layer-z">
              <button
                type="button"
                className="fp-lbtn"
                title="Move up"
                disabled={z >= count - 1}
                onClick={(e) => {
                  e.stopPropagation()
                  store.reorder(layer.id, 1)
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
                  <path d="M4 9.5L8 5.5l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </button>
              <button
                type="button"
                className="fp-lbtn"
                title="Move down"
                disabled={z <= 0}
                onClick={(e) => {
                  e.stopPropagation()
                  store.reorder(layer.id, -1)
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
                  <path d="M4 6.5L8 10.5l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </button>
            </div>

            <button
              type="button"
              className="fp-lbtn fp-lbtn--danger"
              title="Delete layer"
              onClick={(e) => {
                e.stopPropagation()
                store.removeLayer(layer.id)
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <path
                  d="M3.5 4.5h9M6.5 4.5V3.2a1 1 0 011-1h1a1 1 0 011 1V4.5M5 4.5l.6 8a1 1 0 001 .9h2.8a1 1 0 001-.9l.6-8"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}

/* ============================================================================
   Registry + icons
   ========================================================================== */

/* ============================================================================
   Text — per text-layer styling (font / size / color / style)
   ========================================================================== */

const ALIGN_OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' }
]

const TextPanel: React.FC = () => {
  const layer = useSelectedLayer()
  if (!layer || layer.kind !== 'text' || !layer.text) {
    return <EmptyState>Select a text layer</EmptyState>
  }
  const t = layer.text
  const apply = (patch: Partial<typeof t>): void => void updateTextLayer(layer, patch)
  return (
    <div className="fp-stack">
      <Field label="Text">
        <textarea
          className="fp-input fp-textarea"
          rows={2}
          value={t.content}
          spellCheck={false}
          onChange={(e) => apply({ content: e.target.value })}
        />
      </Field>
      <Field label="Font">
        <Dropdown
          value={t.fontFamily}
          options={FONT_FAMILIES.map((f) => ({ value: f, label: f }))}
          onChange={(v) => apply({ fontFamily: v })}
        />
      </Field>
      <Slider label="Size" value={t.fontSize} min={8} max={220} step={1} unit="px"
        onChange={(v) => apply({ fontSize: v })} />
      <Field label="Color">
        <input
          className="fp-color"
          type="color"
          value={t.color}
          onChange={(e) => apply({ color: e.target.value })}
        />
      </Field>
      <Field label="Bold">
        <Switch checked={t.bold} onChange={(v) => apply({ bold: v })} />
      </Field>
      <Field label="Italic">
        <Switch checked={t.italic} onChange={(v) => apply({ italic: v })} />
      </Field>
      <Field label="Align">
        <Segmented value={t.align} options={ALIGN_OPTIONS}
          onChange={(v) => apply({ align: v as TextAlign })} />
      </Field>
      <Slider label="Line height" value={t.lineHeight} min={0.8} max={2.2} step={0.05}
        onChange={(v) => apply({ lineHeight: v })} />
      <Slider label="Letter spacing" value={t.letterSpacing} min={-5} max={24} step={0.5} unit="px" bipolar
        onChange={(v) => apply({ letterSpacing: v })} />
    </div>
  )
}

export const ICONS: Record<string, JSX.Element> = {
  layers: (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <path d="M10 2.5l7 3.5-7 3.5-7-3.5 7-3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none" />
      <path d="M3 10l7 3.5L17 10M3 13.5L10 17l7-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none" />
    </svg>
  ),
  text: (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <path d="M4 5.5V4h12v1.5M10 4v12M7.5 16h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ),
  transform: (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <path d="M10 2.5v15M2.5 10h15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M10 2.5l-2.2 2.5M10 2.5l2.2 2.5M10 17.5l-2.2-2.5M10 17.5l2.2-2.5M2.5 10l2.5-2.2M2.5 10l2.5 2.2M17.5 10l-2.5-2.2M17.5 10l-2.5 2.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ),
  source: (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <rect x="2.8" y="3.8" width="14.4" height="12.4" rx="2" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="7" cy="8" r="1.4" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M3.5 14l4-3.5 3 2.5 2.5-2 3.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ),
  tone: (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <path d="M5 4.5v11M10 4.5v11M15 4.5v11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <circle cx="5" cy="12.5" r="1.8" fill="currentColor" />
      <circle cx="10" cy="7" r="1.8" fill="currentColor" />
      <circle cx="15" cy="11" r="1.8" fill="currentColor" />
    </svg>
  ),
  output: (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <rect x="2.8" y="4" width="14.4" height="9.5" rx="1.6" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M7 16.5h6M10 13.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M5.5 6.5h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" fill="none" />
    </svg>
  ),
  project: (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M10 1.8v2.2M10 16v2.2M18.2 10H16M4 10H1.8M15.8 4.2l-1.6 1.6M5.8 14.2l-1.6 1.6M15.8 15.8l-1.6-1.6M5.8 5.8L4.2 4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export const PANELS: { id: string; title: string; Body: React.FC }[] = [
  { id: 'transform', title: 'Transform', Body: TransformPanel },
  { id: 'text', title: 'Text', Body: TextPanel },
  { id: 'source', title: 'Source', Body: SourcePanel },
  { id: 'tone', title: 'Tone', Body: TonePanel },
  { id: 'output', title: 'Output', Body: OutputPanel },
  { id: 'project', title: 'Project', Body: ProjectPanel }
]
