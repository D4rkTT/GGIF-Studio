declare module 'gifuct-js' {
  export interface ParsedFrame {
    dims: { top: number; left: number; width: number; height: number }
    patch: Uint8ClampedArray
    pixels: Uint8Array
    delay: number
    disposalType: number
    colorTable: number[][]
    transparentIndex: number
  }
  export interface ParsedGif {
    lsd: { width: number; height: number }
    frames: unknown[]
  }
  export function parseGIF(buf: ArrayBuffer | Uint8Array): ParsedGif
  export function decompressFrames(gif: ParsedGif, buildPatch: boolean): ParsedFrame[]
}
