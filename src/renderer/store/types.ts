// Multi-layer project model. Geometry/timing live per-layer; the 1-bit
// pixelation pass is global (the OLED is one monochrome surface).

export type LayerKind = 'gif' | 'video' | 'image' | 'text'

export type TextAlign = 'left' | 'center' | 'right'

export interface TextSpec {
  content: string
  fontFamily: string
  fontSize: number // px
  color: string // css color
  bold: boolean
  italic: boolean
  align: TextAlign
  lineHeight: number // multiplier
  letterSpacing: number // px
}

export const DEFAULT_TEXT: TextSpec = {
  content: 'Text',
  fontFamily: 'Inter',
  fontSize: 48,
  color: '#ffffff',
  bold: true,
  italic: false,
  align: 'center',
  lineHeight: 1.1,
  letterSpacing: 0
}

export const FONT_FAMILIES = [
  'Inter',
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Impact',
  'Comic Sans MS',
  'Trebuchet MS'
] as const

/** Decoded media, shared by reference across layers that use the same file. */
export interface SourceData {
  id: string
  name: string
  kind: LayerKind
  width: number
  height: number
  durationMs: number
  // cumulative-timed frames for O(log n) sampling
  frames: { bitmap: ImageBitmap; delayMs: number; tStart: number }[]
  // original file bytes (media) — kept so projects can be saved/reopened.
  // Text sources omit this (regenerated from the layer's TextSpec).
  bytes?: ArrayBuffer
}

export interface Layer {
  id: string
  name: string
  sourceId: string
  kind: LayerKind

  // timeline placement (milliseconds)
  start: number // position on the global timeline
  in: number // trim-in inside the source
  out: number // trim-out inside the source (in < out <= duration)
  len: number // clip length on the timeline; if > (out-in) the source loops

  // present only when kind === 'text'
  text?: TextSpec

  // transform in DESIGN space (origin = canvas center, +x right, +y down)
  x: number
  y: number
  scale: number
  rotation: number // degrees
  opacity: number // 0..1
  flipH: boolean
  flipV: boolean

  visible: boolean
  locked: boolean
}

export type DitherMode = 'floyd-steinberg' | 'atkinson' | 'ordered' | 'threshold' | 'none'
export type BgFill = 'black' | 'white'

/** Global 1-bit conversion settings (applied to the composited result). */
export interface RenderSettings {
  bgFill: BgFill
  brightness: number
  contrast: number
  gamma: number
  normalize: boolean
  threshold: number
  dither: DitherMode
  invert: boolean
}

export interface Project {
  width: number
  height: number
  fps: number
  speed: number
  loop: boolean
  minFrameMs: number
  duration: number // ms (derived from layers, min 1000)
  layers: Layer[] // index 0 = bottom of z-order
  selectedId: string | null
  playhead: number // ms
  render: RenderSettings
}

export const DEFAULT_RENDER: RenderSettings = {
  bgFill: 'black',
  brightness: 0,
  contrast: 0,
  gamma: 1,
  normalize: false,
  threshold: 128,
  dither: 'floyd-steinberg',
  invert: false
}

export function emptyProject(): Project {
  return {
    width: 128,
    height: 52,
    fps: 30,
    speed: 1,
    loop: true,
    minFrameMs: 30,
    duration: 3000,
    layers: [],
    selectedId: null,
    playhead: 0,
    render: { ...DEFAULT_RENDER }
  }
}
