import { store } from './store/store'
import { renderComposite, pixelate } from './compositor'

const api = window.ggif

/** Shared transport clock. The display render loop and the OLED player both
 *  read this so screen + device stay in sync without React re-renders. */
export const clock = { time: 0, playing: false }

export class Player {
  private canvas = document.createElement('canvas')
  private gen = 0
  private sleeper: { resolve: () => void; timer: number } | null = null

  onStateChange: (playing: boolean) => void = () => {}
  onError: (msg: string) => void = () => {}

  isPlaying(): boolean {
    return clock.playing
  }

  private ctx(w: number, h: number): CanvasRenderingContext2D {
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    return this.canvas.getContext('2d', { willReadFrequently: true })!
  }

  private packAt(timeMs: number): { packed: number[]; w: number; h: number } {
    const p = store.getState()
    const ctx = this.ctx(p.width, p.height)
    renderComposite(ctx, p, timeMs, p.width, p.height)
    const data = ctx.getImageData(0, 0, p.width, p.height).data
    const { packed } = pixelate(data, p.width, p.height, p.render)
    return { packed, w: p.width, h: p.height }
  }

  async start(): Promise<void> {
    await this.stop()
    const p = store.getState()
    if (p.layers.length === 0) return
    await api.register(p.width, p.height)
    this.gen++
    const myGen = this.gen
    clock.playing = true
    this.onStateChange(true)
    void this.loop(myGen)
  }

  private async loop(myGen: number): Promise<void> {
    let last = performance.now()
    while (clock.playing && this.gen === myGen) {
      const p = store.getState()
      const iterStart = performance.now()

      // advance playhead by REAL elapsed wall-clock time → playback is always
      // realtime regardless of how slow the device link is (frames are dropped
      // on the device, not stretched in time).
      const dt = (iterStart - last) * Math.max(0.1, p.speed)
      last = iterStart
      let next = clock.time + dt
      if (next >= p.duration) {
        if (p.loop) next = p.duration > 0 ? next % p.duration : 0
        else {
          clock.time = p.duration
          clock.playing = false
          this.onStateChange(false)
          store.setPlayhead(p.duration)
          break
        }
      }
      clock.time = next

      const { packed, w, h } = this.packAt(clock.time)
      try {
        await api.sendFrame(packed, w, h)
      } catch (e) {
        this.onError(String((e as Error)?.message ?? e))
      }
      if (this.gen !== myGen || !clock.playing) break

      // device send-rate cap: fps controls how often we PUSH to the OLED, not
      // playback speed. Sleep only the remainder of the target interval.
      const interval = Math.max(p.minFrameMs, 1000 / Math.max(1, p.fps))
      const elapsed = performance.now() - iterStart
      if (elapsed < interval) await this.sleep(interval - elapsed)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.sleeper = null
        resolve()
      }, ms)
      this.sleeper = { resolve, timer }
    })
  }
  private cancelSleep(): void {
    if (this.sleeper) {
      clearTimeout(this.sleeper.timer)
      this.sleeper.resolve()
      this.sleeper = null
    }
  }

  /** Push a single composited frame to the OLED (paused scrub preview). */
  async showStill(timeMs: number): Promise<void> {
    if (clock.playing) return
    const p = store.getState()
    if (p.layers.length === 0) return
    try {
      await api.register(p.width, p.height)
      const { packed, w, h } = this.packAt(timeMs)
      await api.sendFrame(packed, w, h)
    } catch {
      /* ignore transient */
    }
  }

  async stop(): Promise<void> {
    const was = clock.playing
    clock.playing = false
    this.gen++
    this.cancelSleep()
    if (was) {
      this.onStateChange(false)
      store.setPlayhead(clock.time)
      const p = store.getState()
      const blank = new Array(Math.ceil((p.width * p.height) / 8)).fill(0)
      await api.sendFrame(blank, p.width, p.height).catch(() => {})
    }
    await api.stopEngine().catch(() => {})
  }
}

export const player = new Player()
