// src/renderer/media.ts
//
// Unified source decoder for the renderer process.
//
// Turns a dropped/loaded file (GIF or video) into a flat array of
// fully-composited, full-canvas RGBA frames plus per-frame delays, ready to be
// fed into the 1-bit OLED image pipeline. All decoding, compositing, sampling
// and downscaling happens here in the renderer — main only does engine I/O.
//
// Two paths:
//   - GIF   : gifuct-js decode + manual disposal compositing (mirrors the
//             main-process logic in src/main/gif.ts, adapted to run in the DOM
//             and with downscaling). No <canvas> required for the composite
//             itself; we only touch a canvas to downscale.
//   - VIDEO : HTMLVideoElement decode. We sample on a fixed-fps time grid by
//             seeking, and confirm the *actual* landed presentation time via
//             requestVideoFrameCallback (rVFC) when available, falling back to
//             video.currentTime otherwise. Each sampled frame is drawn to an
//             OffscreenCanvas (or HTMLCanvasElement fallback) and read back as
//             RGBA.
//
// Both paths return frames downscaled so the longest dimension is <= 480px.
// The physical target is only 128px wide, so 480 is a comfortable, memory-safe
// working resolution that still leaves headroom for crop/zoom in the UI.

import { parseGIF, decompressFrames, type ParsedFrame } from 'gifuct-js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SourceKind = 'gif' | 'video'

/** One decoded frame: full-canvas RGBA pixels + how long to display it. */
export interface RawFrame {
  /** RGBA bytes, length === width * height * 4. Opaque (alpha forced to 255). */
  rgba: Uint8ClampedArray
  /** Display duration of this frame in milliseconds (always >= 1). */
  delayMs: number
}

export interface DecodedSource {
  kind: SourceKind
  /** Output frame width in pixels (post-downscale). */
  width: number
  /** Output frame height in pixels (post-downscale). */
  height: number
  frames: RawFrame[]
  /** Sum of all frame delays in milliseconds. */
  durationMs: number
}

export interface DecodeOptions {
  /** Hard cap on number of frames produced. Default 300. */
  maxFrames?: number
  /** Target sampling rate for video (frames per second). Default 20. */
  fps?: number
  /** Progress callback, p in [0, 1]. Called periodically during decode. */
  onProgress?(p: number): void
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Longest output dimension, in pixels. Bounds per-frame memory. */
const MAX_DIMENSION = 480

/** Default fallback frame delay (ms) when a source reports none. */
const DEFAULT_DELAY_MS = 100

// requestVideoFrameCallback / cancelVideoFrameCallback are declared by the DOM
// lib in this toolchain, so we use HTMLVideoElement directly and feature-detect
// rVFC at runtime (it can still be absent on some engines).

// A 2D context that may be backed by either canvas flavour. Both expose the
// subset of methods we need with compatible signatures.
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
type Any2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Decode a GIF or video file into composited RGBA frames.
 *
 * @param file  { name, buffer } — `name` is used (with a content sniff) to pick
 *              the decode path; `buffer` is the raw file bytes.
 * @param opts  see {@link DecodeOptions}.
 */
export async function decodeSource(
  file: { name: string; buffer: ArrayBuffer },
  opts: DecodeOptions = {}
): Promise<DecodedSource> {
  const kind = detectKind(file)
  if (kind === 'gif') {
    return decodeGifSource(file.buffer, opts)
  }
  return decodeVideoSource(file, opts)
}

// ---------------------------------------------------------------------------
// Kind detection
// ---------------------------------------------------------------------------

/**
 * Decide GIF vs video. Prefer a magic-byte sniff (robust to wrong/missing
 * extensions) and fall back to the file extension.
 */
function detectKind(file: { name: string; buffer: ArrayBuffer }): SourceKind {
  // GIFs start with ASCII "GIF87a" or "GIF89a".
  const head = new Uint8Array(file.buffer, 0, Math.min(6, file.buffer.byteLength))
  if (
    head.length >= 6 &&
    head[0] === 0x47 && // G
    head[1] === 0x49 && // I
    head[2] === 0x46 && // F
    head[3] === 0x38 && // 8
    (head[4] === 0x37 || head[4] === 0x39) && // 7 | 9
    head[5] === 0x61 // a
  ) {
    return 'gif'
  }

  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'gif') return 'gif'
  // mp4 / m4v / mov / webm / mkv / ogv etc. all go through the video path.
  return 'video'
}

// ---------------------------------------------------------------------------
// GIF path
// ---------------------------------------------------------------------------

/**
 * Decode + composite a GIF. Honors disposal methods so optimized/partial GIFs
 * render correctly:
 *   - disposal 2 (restore to background): clear the frame's rect afterwards.
 *   - disposal 3 (restore to previous): snapshot before, restore after.
 * Mirrors src/main/gif.ts, then downscales to MAX_DIMENSION.
 */
function decodeGifSource(buffer: ArrayBuffer, opts: DecodeOptions): DecodedSource {
  const { maxFrames = 300, onProgress } = opts

  const gif = parseGIF(buffer)
  const raw: ParsedFrame[] = decompressFrames(gif, true)
  if (raw.length === 0) throw new Error('GIF has no frames')

  const srcW = gif.lsd.width
  const srcH = gif.lsd.height
  if (srcW <= 0 || srcH <= 0) throw new Error('GIF has invalid dimensions')

  // Compositing accumulator at native size (RGBA, starts fully transparent).
  const composite = new Uint8ClampedArray(srcW * srcH * 4)
  let previous: Uint8ClampedArray | null = null

  // Downscaler (no-op passthrough when source already within bounds).
  const scaler = createScaler(srcW, srcH)

  const frames: RawFrame[] = []
  let durationMs = 0

  const limit = Math.min(raw.length, maxFrames)
  for (let i = 0; i < raw.length && frames.length < maxFrames; i++) {
    const f = raw[i]

    // Snapshot BEFORE drawing if this frame must later restore-to-previous.
    if (f.disposalType === 3) previous = composite.slice()

    drawPatch(composite, srcW, srcH, f)

    const delayMs = f.delay && f.delay > 0 ? f.delay : DEFAULT_DELAY_MS
    durationMs += delayMs

    // Capture the displayed frame (downscaled) before applying disposal.
    frames.push({ rgba: scaler.scale(composite), delayMs })

    // Apply disposal AFTER capturing.
    if (f.disposalType === 2) {
      clearRect(composite, srcW, srcH, f.dims.left, f.dims.top, f.dims.width, f.dims.height)
    } else if (f.disposalType === 3 && previous) {
      composite.set(previous)
    }

    onProgress?.(Math.min(1, (i + 1) / limit))
  }

  onProgress?.(1)
  return {
    kind: 'gif',
    width: scaler.outW,
    height: scaler.outH,
    frames,
    durationMs,
  }
}

/** Composite one gifuct patch onto the accumulator, skipping transparent px. */
function drawPatch(
  composite: Uint8ClampedArray,
  width: number,
  height: number,
  f: ParsedFrame
): void {
  const { top, left, width: fw, height: fh } = f.dims
  const patch = f.patch // RGBA; transparent pixels already have alpha 0
  for (let y = 0; y < fh; y++) {
    const cy = top + y
    if (cy < 0 || cy >= height) continue
    for (let x = 0; x < fw; x++) {
      const cx = left + x
      if (cx < 0 || cx >= width) continue
      const pi = (y * fw + x) * 4
      if (patch[pi + 3] === 0) continue // keep what's underneath
      const ci = (cy * width + cx) * 4
      composite[ci] = patch[pi]
      composite[ci + 1] = patch[pi + 1]
      composite[ci + 2] = patch[pi + 2]
      composite[ci + 3] = 255
    }
  }
}

/** Zero out a rectangle of the accumulator (disposal-to-background). */
function clearRect(
  composite: Uint8ClampedArray,
  width: number,
  height: number,
  left: number,
  top: number,
  fw: number,
  fh: number
): void {
  for (let y = 0; y < fh; y++) {
    const cy = top + y
    if (cy < 0 || cy >= height) continue
    for (let x = 0; x < fw; x++) {
      const cx = left + x
      if (cx < 0 || cx >= width) continue
      const ci = (cy * width + cx) * 4
      composite[ci] = composite[ci + 1] = composite[ci + 2] = composite[ci + 3] = 0
    }
  }
}

// ---------------------------------------------------------------------------
// Video path
// ---------------------------------------------------------------------------

/**
 * Decode a video by sampling on a fixed-fps grid. We seek to each target time,
 * wait for `seeked`, then confirm the actual landed presentation time via rVFC
 * (or fall back to currentTime). Frames are drawn to a (possibly downscaled)
 * canvas and read back as RGBA. Memory is bounded by maxFrames + downscaling.
 */
async function decodeVideoSource(
  file: { name: string; buffer: ArrayBuffer },
  opts: DecodeOptions
): Promise<DecodedSource> {
  const { maxFrames = 300, fps = 20, onProgress } = opts
  const targetFps = fps > 0 ? fps : 20

  // Wrap the bytes in a same-origin blob: URL so the canvas isn't tainted.
  const mime = guessVideoMime(file.name)
  const blob = new Blob([file.buffer], mime ? { type: mime } : undefined)
  const url = URL.createObjectURL(blob)

  const video = document.createElement('video') as HTMLVideoElement
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'
  // Keep it out of layout but still decodable.
  video.style.position = 'fixed'
  video.style.left = '-99999px'
  video.style.width = '1px'
  video.style.height = '1px'
  video.src = url
  // Detached <video> elements frequently refuse to decode/seek in Chromium —
  // attach (off-screen) so metadata + seeked events actually fire.
  document.body.appendChild(video)
  video.load()

  try {
    await withTimeout(loadMetadata(video), 15000, 'Video metadata timed out (unsupported codec?)')

    let duration = video.duration
    if (!isFinite(duration) || duration <= 0) {
      duration = await resolveDurationBySeek(video)
    }
    if (!isFinite(duration) || duration <= 0) {
      throw new Error('Could not determine video duration')
    }

    const vw = video.videoWidth
    const vh = video.videoHeight
    if (vw <= 0 || vh <= 0) throw new Error('Video has invalid dimensions')

    // Output canvas, downscaled so the longest side <= MAX_DIMENSION.
    const scale = Math.min(1, MAX_DIMENSION / Math.max(vw, vh))
    const outW = Math.max(1, Math.round(vw * scale))
    const outH = Math.max(1, Math.round(vh * scale))
    const { ctx } = createCanvas(outW, outH)

    // Build the sampling grid: t = 0, dt, 2dt, ... capped by maxFrames.
    const dt = 1 / targetFps
    const times: number[] = []
    for (let t = 0; t < duration && times.length < maxFrames; t += dt) {
      times.push(t)
    }
    if (times.length === 0) times.push(0)

    const supportsRVFC = typeof video.requestVideoFrameCallback === 'function'

    interface Sampled {
      rgba: Uint8ClampedArray
      t: number // actual landed presentation time (seconds)
    }
    const sampled: Sampled[] = []
    let prevActual: number | null = null

    for (let i = 0; i < times.length; i++) {
      const actual = await withTimeout(
        seekTo(video, times[i], duration, supportsRVFC),
        8000,
        'Video seek timed out'
      )

      // Dedupe: imprecise / keyframe-only seeks can land on the same frame.
      if (prevActual !== null && Math.abs(actual - prevActual) < 1e-4) {
        onProgress?.((i + 1) / times.length)
        continue
      }

      ctx.drawImage(video as CanvasImageSource, 0, 0, outW, outH)
      const img = ctx.getImageData(0, 0, outW, outH)
      forceOpaque(img.data)
      sampled.push({ rgba: img.data, t: actual })
      prevActual = actual

      onProgress?.((i + 1) / times.length)
    }

    if (sampled.length === 0) throw new Error('Video produced no frames')

    // Per-frame delays from consecutive landed timestamps. The last frame
    // inherits the average sampling step.
    const frames: RawFrame[] = []
    let durationMs = 0
    for (let i = 0; i < sampled.length; i++) {
      const cur = sampled[i].t
      const next = i + 1 < sampled.length ? sampled[i + 1].t : cur + dt
      const delayMs = Math.max(1, Math.round((next - cur) * 1000))
      durationMs += delayMs
      frames.push({ rgba: sampled[i].rgba, delayMs })
    }

    onProgress?.(1)
    return { kind: 'video', width: outW, height: outH, frames, durationMs }
  } finally {
    // Release the native decoder and the blob URL.
    video.removeAttribute('src')
    try {
      video.load()
    } catch {
      /* ignore */
    }
    video.remove()
    URL.revokeObjectURL(url)
  }
}

/** Reject if a promise doesn't settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(msg)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/** Wait for loadedmetadata, surfacing a clear error on decode failure. */
function loadMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (video.readyState >= 1 /* HAVE_METADATA */) {
      resolve()
      return
    }
    const onLoaded = (): void => {
      cleanup()
      resolve()
    }
    const onError = (): void => {
      cleanup()
      reject(
        new Error(
          'Cannot load/decode video (unsupported codec — e.g. HEVC/H.265, or an ' +
            'ffmpeg build lacking H.264/AAC)'
        )
      )
    }
    const cleanup = (): void => {
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('loadedmetadata', onLoaded, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}

/**
 * Seek to time `t`, resolve with the ACTUAL landed presentation time.
 * Uses rVFC's mediaTime when available (most accurate), else currentTime.
 */
function seekTo(
  video: HTMLVideoElement,
  t: number,
  duration: number,
  supportsRVFC: boolean
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let done = false
    const finish = (actual: number): void => {
      if (done) return
      done = true
      cleanup()
      resolve(actual)
    }
    const fail = (): void => {
      if (done) return
      done = true
      cleanup()
      reject(new Error('Video seek failed'))
    }
    const onSeeked = (): void => {
      // A paused, off-screen <video> never "presents" a frame, so
      // requestVideoFrameCallback would hang here. The frame IS decoded once
      // `seeked` fires, so use currentTime and draw on the next animation frame.
      void supportsRVFC
      requestAnimationFrame(() => finish(video.currentTime))
    }
    const cleanup = (): void => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', fail)
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', fail, { once: true })

    // Clamp just inside the end so the final sample doesn't no-op past EOF.
    const clamped = Math.max(0, Math.min(t, duration - 1e-3))
    try {
      video.currentTime = clamped
    } catch {
      fail()
    }
  })
}

/**
 * Some webm/streamed blobs report duration Infinity/NaN. Seek far past the end;
 * Chromium clamps and then reports the real duration.
 */
function resolveDurationBySeek(video: HTMLVideoElement): Promise<number> {
  return new Promise<number>((resolve) => {
    const onChange = (): void => {
      if (isFinite(video.duration) && video.duration > 0) {
        cleanup()
        // Reset to the start for the subsequent sampling loop.
        try {
          video.currentTime = 0
        } catch {
          /* ignore */
        }
        resolve(video.duration)
      }
    }
    const cleanup = (): void => {
      video.removeEventListener('durationchange', onChange)
      video.removeEventListener('seeked', onChange)
    }
    video.addEventListener('durationchange', onChange)
    video.addEventListener('seeked', onChange)
    try {
      video.currentTime = 1e7
    } catch {
      cleanup()
      resolve(NaN)
    }
  })
}

/** Best-effort MIME guess so the blob is recognized by the decoder. */
function guessVideoMime(name: string): string | undefined {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'mp4':
    case 'm4v':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    case 'webm':
      return 'video/webm'
    case 'mkv':
      return 'video/x-matroska'
    case 'ogv':
      return 'video/ogg'
    default:
      return undefined
  }
}

// ---------------------------------------------------------------------------
// Canvas helpers (shared)
// ---------------------------------------------------------------------------

/** Create an Offscreen or DOM canvas + a 2D context tuned for readback. */
function createCanvas(width: number, height: number): { canvas: AnyCanvas; ctx: Any2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', {
      willReadFrequently: true,
    }) as OffscreenCanvasRenderingContext2D | null
    if (ctx) return { canvas, ctx }
    // Fall through to DOM canvas if Offscreen 2D isn't available.
  }
  const el = document.createElement('canvas')
  el.width = width
  el.height = height
  const ctx = el.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not acquire a 2D canvas context')
  return { canvas: el, ctx }
}

/**
 * A reusable downscaler for full-canvas RGBA frames.
 *
 * If the source already fits within MAX_DIMENSION it returns copies directly
 * (no canvas round-trip). Otherwise it puts each frame onto a native-size
 * canvas and draws it, scaled with smoothing, into the output canvas.
 */
interface Scaler {
  outW: number
  outH: number
  /** Returns a downscaled (or copied) RGBA buffer; never aliases the input. */
  scale(rgba: Uint8ClampedArray): Uint8ClampedArray
}

function createScaler(srcW: number, srcH: number): Scaler {
  const factor = Math.min(1, MAX_DIMENSION / Math.max(srcW, srcH))

  // Passthrough: source already small enough — just hand back copies.
  if (factor >= 1) {
    return {
      outW: srcW,
      outH: srcH,
      scale: (rgba) => rgba.slice(),
    }
  }

  const outW = Math.max(1, Math.round(srcW * factor))
  const outH = Math.max(1, Math.round(srcH * factor))

  // Source canvas holds the native-size frame; dest canvas the scaled result.
  const src = createCanvas(srcW, srcH)
  const dst = createCanvas(outW, outH)
  dst.ctx.imageSmoothingEnabled = true
  // imageSmoothingQuality exists on both context flavours at runtime.
  ;(dst.ctx as CanvasRenderingContext2D).imageSmoothingQuality = 'high'

  return {
    outW,
    outH,
    scale(rgba: Uint8ClampedArray): Uint8ClampedArray {
      // putImageData wants its own ImageData; build one over the buffer.
      const imageData = new ImageData(new Uint8ClampedArray(rgba), srcW, srcH)
      src.ctx.putImageData(imageData, 0, 0)
      dst.ctx.clearRect(0, 0, outW, outH)
      dst.ctx.drawImage(src.canvas as CanvasImageSource, 0, 0, outW, outH)
      const out = dst.ctx.getImageData(0, 0, outW, outH)
      forceOpaque(out.data)
      return out.data
    },
  }
}

/** Force every pixel opaque (alpha = 255). The OLED is 1-bit; alpha is noise. */
function forceOpaque(data: Uint8ClampedArray): void {
  for (let i = 3; i < data.length; i += 4) data[i] = 255
}
