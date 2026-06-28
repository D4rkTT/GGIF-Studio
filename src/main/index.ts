import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { GameSense } from './gamesense'
import { AppSettings, OpenedFile, SUPPORTED_EXT } from '../shared/types'

const isMac = process.platform === 'darwin'
let win: BrowserWindow | null = null
const gs = new GameSense()
let heartbeat: NodeJS.Timeout | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: 'GGIF Studio',
    backgroundColor: '#08090c',
    show: false,
    frame: isMac ? undefined : false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 18 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win?.show())

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function stopHeartbeat(): void {
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = null
}

// ---- engine I/O ----
ipcMain.handle('engine:discover', () => gs.discover())

ipcMain.handle('engine:register', async (_e, w: number, h: number) => {
  const st = await gs.discover()
  if (!st.connected) throw new Error(st.message)
  await gs.register(w, h)
  stopHeartbeat()
  heartbeat = setInterval(() => gs.heartbeat().catch(() => {}), 8000)
})

ipcMain.handle('engine:sendFrame', (_e, packed: number[], w: number, h: number) =>
  gs.sendFrame(packed, w, h)
)

ipcMain.handle('engine:stop', async () => {
  stopHeartbeat()
  await gs.stop().catch(() => {})
})

// ---- file open ----
ipcMain.handle('file:open', async (): Promise<OpenedFile | null> => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Open GIF or video',
    filters: [{ name: 'Media', extensions: [...SUPPORTED_EXT] }],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return null
  const buf = await readFile(r.filePaths[0])
  return { name: basename(r.filePaths[0]), buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
})

// ---- project save / open ----
ipcMain.handle('project:save', async (_e, json: string): Promise<boolean> => {
  const r = await dialog.showSaveDialog(win!, {
    title: 'Save project',
    defaultPath: 'project.ggif',
    filters: [{ name: 'GGIF Project', extensions: ['ggif'] }]
  })
  if (r.canceled || !r.filePath) return false
  await writeFile(r.filePath, json, 'utf8')
  return true
})

ipcMain.handle('project:open', async (): Promise<string | null> => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Open project',
    filters: [{ name: 'GGIF Project', extensions: ['ggif'] }],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return null
  return readFile(r.filePaths[0], 'utf8')
})

// ---- window controls (custom chrome on win/linux) ----
ipcMain.handle('win:minimize', () => win?.minimize())
ipcMain.handle('win:maximize', () => {
  if (!win) return false
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
})
ipcMain.handle('win:close', () => win?.close())
ipcMain.handle('win:platform', () => (isMac ? 'mac' : process.platform === 'win32' ? 'win' : 'other'))

// keep AppSettings import meaningful for typed channels elsewhere
export type { AppSettings }

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  stopHeartbeat()
  await gs.stop().catch(() => {})
  if (!isMac) app.quit()
})

app.on('before-quit', async () => {
  stopHeartbeat()
  await gs.stop().catch(() => {})
})
