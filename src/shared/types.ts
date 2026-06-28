// Types shared between main and renderer processes.

/** Supported OLED resolutions. Verified on hardware: Arctis Nova Pro Wireless
 *  base station = 128x52. Others kept for other SteelSeries OLED devices. */
export const RESOLUTIONS = [
  { w: 128, h: 52, label: '128×52 — Nova Pro Wireless' },
  { w: 128, h: 64, label: '128×64' },
  { w: 128, h: 48, label: '128×48 — Arctis Pro Wireless' },
  { w: 128, h: 40, label: '128×40 — Apex Pro' },
  { w: 128, h: 36, label: '128×36 — Rival 700' }
] as const

export type DitherMode = 'floyd-steinberg' | 'atkinson' | 'ordered' | 'threshold' | 'none'
export type FitMode = 'contain' | 'cover' | 'stretch'
export type Rotation = 0 | 90 | 180 | 270
export type BgFill = 'black' | 'white'

/** Everything that affects how a source frame becomes a 1-bit OLED frame. */
export interface ProcessOptions {
  width: number
  height: number

  // geometry
  fit: FitMode
  rotate: Rotation
  flipH: boolean
  flipV: boolean
  scale: number // 0.2 .. 3  (zoom)
  offsetX: number // -64 .. 64 px in target space
  offsetY: number // -64 .. 64 px

  // source handling
  bgFill: BgFill // what transparent pixels become (fixes black-on-transparent)
  inputInvert: boolean // invert source luminance BEFORE thresholding

  // tone
  brightness: number // -100 .. 100
  contrast: number // -100 .. 100
  gamma: number // 0.1 .. 3
  normalize: boolean // auto stretch levels per frame's min/max
  threshold: number // 0 .. 255

  // output
  dither: DitherMode
  invert: boolean // invert the final 1-bit result
}

export interface PlaybackOptions {
  loop: boolean
  speed: number // 0.1 .. 5
  minFrameMs: number // clamp very fast sources
  trimStart: number // first frame index (inclusive)
  trimEnd: number // last frame index (inclusive); -1 = last
}

export interface AppSettings extends ProcessOptions, PlaybackOptions {}

export const DEFAULT_SETTINGS: AppSettings = {
  width: 128,
  height: 52,
  fit: 'contain',
  rotate: 0,
  flipH: false,
  flipV: false,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  bgFill: 'black',
  inputInvert: false,
  brightness: 0,
  contrast: 0,
  gamma: 1,
  normalize: false,
  threshold: 128,
  dither: 'floyd-steinberg',
  invert: false,
  loop: true,
  speed: 1,
  minFrameMs: 30,
  trimStart: 0,
  trimEnd: -1
}

export interface SourceInfo {
  name: string
  kind: 'gif' | 'video'
  frameCount: number
  srcWidth: number
  srcHeight: number
  durationMs: number
}

export interface EngineStatus {
  connected: boolean
  address: string | null
  message: string
}

export interface OpenedFile {
  name: string
  buffer: ArrayBuffer
}

export const GAME = 'GGIF_Studio'
export const EVENT = 'FRAME'
export const SUPPORTED_EXT = ['gif', 'mp4', 'webm', 'mov', 'm4v'] as const
