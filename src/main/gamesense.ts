import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { GAME, EVENT, EngineStatus } from '../shared/types'

/** coreProps.json location per OS. */
function corePropsPath(): string {
  if (process.platform === 'win32') {
    const base = process.env.PROGRAMDATA || 'C:\\ProgramData'
    return join(base, 'SteelSeries', 'SteelSeries Engine 3', 'coreProps.json')
  }
  if (process.platform === 'darwin') {
    return '/Library/Application Support/SteelSeries Engine 3/coreProps.json'
  }
  // Linux fallback (unofficial engine ports)
  return join(homedir(), '.steelseries', 'coreProps.json')
}

export class GameSense {
  private address: string | null = null
  private boundResolution: { w: number; h: number } | null = null

  status(): EngineStatus {
    return {
      connected: this.address !== null,
      address: this.address,
      message: this.address ? `Engine at ${this.address}` : 'Engine not found'
    }
  }

  /** Read coreProps.json to discover the engine HTTP address. */
  async discover(): Promise<EngineStatus> {
    try {
      const raw = await readFile(corePropsPath(), 'utf8')
      const json = JSON.parse(raw)
      if (typeof json.address !== 'string') throw new Error('no address key')
      this.address = json.address
      return this.status()
    } catch (e) {
      this.address = null
      return {
        connected: false,
        address: null,
        message: 'SteelSeries Engine not running (coreProps.json not found)'
      }
    }
  }

  private async post(endpoint: string, body: unknown): Promise<void> {
    if (!this.address) throw new Error('engine address unknown')
    const res = await fetch(`http://${this.address}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`${endpoint} -> ${res.status} ${text}`)
    }
  }

  /** Register metadata + bind a screen handler for the given resolution. */
  async register(w: number, h: number): Promise<void> {
    await this.post('game_metadata', {
      game: GAME,
      game_display_name: 'GGIF Studio',
      developer: 'DarkT',
      deinitialize_timer_length_ms: 15000
    })

    const blank = new Array(Math.ceil((w * h) / 8)).fill(0)
    await this.post('bind_game_event', {
      game: GAME,
      event: EVENT,
      value_optional: true,
      handlers: [
        {
          'device-type': `screened-${w}x${h}`,
          zone: 'one',
          mode: 'screen',
          datas: [{ 'has-text': false, 'image-data': blank }]
        }
      ]
    })
    this.boundResolution = { w, h }
  }

  /** Push one packed 1-bit frame to the screen. `packed` length = ceil(w*h/8). */
  async sendFrame(packed: number[], w: number, h: number): Promise<void> {
    const key = `image-data-${w}x${h}`
    await this.post('game_event', {
      game: GAME,
      event: EVENT,
      data: { frame: { [key]: packed } }
    })
  }

  async heartbeat(): Promise<void> {
    if (!this.address) return
    await this.post('game_heartbeat', { game: GAME }).catch(() => {})
  }

  async stop(): Promise<void> {
    if (!this.address) return
    await this.post('remove_game', { game: GAME }).catch(() => {})
    this.boundResolution = null
  }
}
