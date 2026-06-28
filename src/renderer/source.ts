import { decodeSource } from './media'
import { SourceData } from './store/types'
import { uid } from './store/store'

/** Decode a file and turn it into a SourceData (ImageBitmaps + cumulative times). */
export async function loadSource(
  file: { name: string; buffer: ArrayBuffer },
  onProgress?: (p: number) => void
): Promise<SourceData> {
  const decoded = await decodeSource(file, { fps: 24, maxFrames: 600, onProgress })
  const frames: SourceData['frames'] = []
  let t = 0
  for (const fr of decoded.frames) {
    const img = new ImageData(decoded.width, decoded.height)
    img.data.set(fr.rgba)
    const bitmap = await createImageBitmap(img)
    frames.push({ bitmap, delayMs: fr.delayMs, tStart: t })
    t += fr.delayMs
  }
  return {
    id: uid('s'),
    name: file.name,
    kind: decoded.kind,
    width: decoded.width,
    height: decoded.height,
    durationMs: Math.max(1, t),
    frames,
    bytes: file.buffer
  }
}
