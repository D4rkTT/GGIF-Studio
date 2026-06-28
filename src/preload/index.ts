import { contextBridge, ipcRenderer } from 'electron'
import { EngineStatus, OpenedFile } from '../shared/types'

const api = {
  // engine
  discoverEngine: (): Promise<EngineStatus> => ipcRenderer.invoke('engine:discover'),
  register: (w: number, h: number): Promise<void> => ipcRenderer.invoke('engine:register', w, h),
  sendFrame: (packed: number[], w: number, h: number): Promise<void> =>
    ipcRenderer.invoke('engine:sendFrame', packed, w, h),
  stopEngine: (): Promise<void> => ipcRenderer.invoke('engine:stop'),
  // files
  openFile: (): Promise<OpenedFile | null> => ipcRenderer.invoke('file:open'),
  saveProject: (json: string): Promise<boolean> => ipcRenderer.invoke('project:save', json),
  openProject: (): Promise<string | null> => ipcRenderer.invoke('project:open'),
  // window
  minimize: (): Promise<void> => ipcRenderer.invoke('win:minimize'),
  maximize: (): Promise<boolean> => ipcRenderer.invoke('win:maximize'),
  close: (): Promise<void> => ipcRenderer.invoke('win:close'),
  platform: (): Promise<'mac' | 'win' | 'other'> => ipcRenderer.invoke('win:platform')
}

contextBridge.exposeInMainWorld('ggif', api)
export type GgifApi = typeof api
