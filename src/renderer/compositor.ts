import { getSource } from './store/store'
import { Project, RenderSettings, SourceData } from './store/types'

/** Binary-search the frame whose interval contains srcTime (ms). */
function sampleBitmap(src: SourceData, srcTime: number): ImageBitmap | null {
  const f = src.frames
  if (f.length === 0) return null
  const t = Math.max(0, Math.min(srcTime, src.durationMs - 0.001))
  let lo = 0
  let hi = f.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (f[mid].tStart <= t) lo = mid
    else hi = mid - 1
  }
  return f[lo].bitmap
}

/** Composite all active layers for time `timeMs` into a device-pixel context.
 *  The context's canvas must be (deviceW x deviceH); design space is the
 *  project's width x height, scaled up to fill it. */
export function renderComposite(
  ctx: CanvasRenderingContext2D,
  project: Project,
  timeMs: number,
  deviceW: number,
  deviceH: number
): void {
  const sx = deviceW / project.width
  const sy = deviceH / project.height
  ctx.fillStyle = project.render.bgFill === 'white' ? '#fff' : '#000'
  ctx.fillRect(0, 0, deviceW, deviceH)
  ctx.imageSmoothingEnabled = true

  for (const layer of project.layers) {
    if (!layer.visible) continue
    const src = getSource(layer.sourceId)
    if (!src) continue
    const span = layer.out - layer.in
    const localT = timeMs - layer.start
    if (localT < 0 || localT > layer.len) continue
    // loop the trimmed source segment to fill the (possibly longer) clip length
    const srcT = span > 0 ? layer.in + (localT % span) : layer.in
    const bmp = sampleBitmap(src, srcT)
    if (!bmp) continue

    const w = src.width * layer.scale
    const h = src.height * layer.scale
    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.translate((project.width / 2 + layer.x) * sx, (project.height / 2 + layer.y) * sy)
    ctx.rotate((layer.rotation * Math.PI) / 180)
    ctx.scale((layer.flipH ? -1 : 1) * sx, (layer.flipV ? -1 : 1) * sy)
    ctx.drawImage(bmp, -w / 2, -h / 2, w, h)
    ctx.restore()
  }
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
].map((r) => r.map((v) => (v + 0.5) * (256 / 16)))

export interface Mono {
  mono: Uint8Array
  packed: number[]
}

/** Convert a composited RGBA buffer (already at target w x h) to 1-bit. */
export function pixelate(rgba: Uint8ClampedArray, w: number, h: number, r: RenderSettings): Mono {
  const n = w * h
  const gray = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const j = i * 4
    gray[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]
  }

  if (r.normalize) {
    let lo = 255
    let hi = 0
    for (let i = 0; i < n; i++) {
      if (gray[i] < lo) lo = gray[i]
      if (gray[i] > hi) hi = gray[i]
    }
    const range = hi - lo
    if (range > 1) {
      const k = 255 / range
      for (let i = 0; i < n; i++) gray[i] = (gray[i] - lo) * k
    }
  }

  const bri = r.brightness * 2.55
  const c = r.contrast / 100
  const cf = (1 + c) / (1 - c + 1e-6)
  const invG = 1 / Math.max(0.1, r.gamma)
  for (let i = 0; i < n; i++) {
    let v = 255 * Math.pow(gray[i] / 255, invG) + bri
    v = (v - 128) * cf + 128
    gray[i] = v < 0 ? 0 : v > 255 ? 255 : v
  }

  const mono = new Uint8Array(n)
  const t = r.threshold
  if (r.dither === 'floyd-steinberg' || r.dither === 'atkinson') {
    const buf = Float32Array.from(gray)
    const atk = r.dither === 'atkinson'
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const nv = buf[i] >= t ? 255 : 0
        mono[i] = nv
        const err = buf[i] - nv
        if (atk) {
          const e = err / 8
          if (x + 1 < w) buf[i + 1] += e
          if (x + 2 < w) buf[i + 2] += e
          if (y + 1 < h) {
            if (x > 0) buf[i + w - 1] += e
            buf[i + w] += e
            if (x + 1 < w) buf[i + w + 1] += e
          }
          if (y + 2 < h) buf[i + 2 * w] += e
        } else {
          if (x + 1 < w) buf[i + 1] += (err * 7) / 16
          if (y + 1 < h) {
            if (x > 0) buf[i + w - 1] += (err * 3) / 16
            buf[i + w] += (err * 5) / 16
            if (x + 1 < w) buf[i + w + 1] += (err * 1) / 16
          }
        }
      }
    }
  } else if (r.dither === 'ordered') {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) mono[y * w + x] = gray[y * w + x] >= BAYER4[y & 3][x & 3] ? 255 : 0
  } else {
    const thr = r.dither === 'none' ? 128 : t
    for (let i = 0; i < n; i++) mono[i] = gray[i] >= thr ? 255 : 0
  }
  if (r.invert) for (let i = 0; i < n; i++) mono[i] = mono[i] ? 0 : 255

  const packed = new Array(Math.ceil(n / 8)).fill(0)
  for (let i = 0; i < n; i++) if (mono[i]) packed[i >> 3] |= 0x80 >> (i & 7)
  return { mono, packed }
}
