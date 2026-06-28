import { SourceData, TextSpec, DEFAULT_TEXT, Layer } from './store/types'
import { store, uid } from './store/store'

const SS = 2 // supersample for crisper grayscale before 1-bit dithering

/** Render a TextSpec to an offscreen canvas → ImageBitmap → SourceData.
 *  Text layers are just image layers whose bitmap comes from text, so the
 *  compositor / gizmo / hit-test all work unchanged. */
export async function makeTextSource(spec: TextSpec): Promise<SourceData> {
  const fontStr = `${spec.italic ? 'italic ' : ''}${spec.bold ? '700' : '400'} ${spec.fontSize}px "${spec.fontFamily}", sans-serif`
  const lines = (spec.content || ' ').split('\n')

  const meas = document.createElement('canvas').getContext('2d')!
  meas.font = fontStr
  try {
    meas.letterSpacing = `${spec.letterSpacing}px`
  } catch {
    /* older engines */
  }
  let maxW = 1
  for (const ln of lines) maxW = Math.max(maxW, meas.measureText(ln || ' ').width)
  const lineH = spec.fontSize * spec.lineHeight
  const pad = Math.ceil(spec.fontSize * 0.25)
  const w = Math.ceil(maxW + pad * 2)
  const h = Math.ceil(lineH * lines.length + pad * 2)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, w * SS)
  canvas.height = Math.max(1, h * SS)
  const ctx = canvas.getContext('2d')!
  ctx.scale(SS, SS)
  ctx.font = fontStr
  try {
    ctx.letterSpacing = `${spec.letterSpacing}px`
  } catch {
    /* ignore */
  }
  ctx.textBaseline = 'top'
  ctx.textAlign = spec.align
  ctx.fillStyle = spec.color
  const x = spec.align === 'left' ? pad : spec.align === 'right' ? w - pad : w / 2
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, pad + i * lineH)
  }

  const bitmap = await createImageBitmap(canvas)
  return {
    id: uid('s'),
    name: 'Text',
    kind: 'text',
    width: canvas.width,
    height: canvas.height,
    durationMs: 30000,
    frames: [{ bitmap, delayMs: 30000, tStart: 0 }]
  }
}

/** Add a new text layer with default styling. */
export async function addTextLayer(): Promise<void> {
  const spec: TextSpec = { ...DEFAULT_TEXT }
  const src = await makeTextSource(spec)
  // default to a 3s clip; source duration stays large so no loop separators show
  store.addLayer(src, { text: spec, scale: 1 / SS, len: 3000 })
}

/** Re-render a text layer after editing its spec. */
export async function updateTextLayer(layer: Layer, patch: Partial<TextSpec>): Promise<void> {
  const spec: TextSpec = { ...(layer.text ?? DEFAULT_TEXT), ...patch }
  const src = await makeTextSource(spec)
  store.setLayerSource(layer.id, src, { text: spec, name: spec.content.slice(0, 24) || 'Text' })
}
