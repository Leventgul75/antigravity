import { contextBridge, ipcRenderer } from 'electron'

export interface DahakanAPI {
  ai: {
    ask: (message: string) => Promise<string>
    askStream: (message: string, onChunk: (chunk: string) => void) => Promise<void>
    clearHistory: () => Promise<void>
    greeting: () => Promise<string>
    macroMatch: (message: string) => Promise<string[] | null>
  }
  voice: {
    startListening: () => Promise<void>
    stopListening: () => Promise<string>
    sendAudioChunk: (chunk: Uint8Array) => void
    speak: (text: string) => Promise<void>
    stopSpeaking: () => Promise<void>
  }
  system: {
    runCommand: (cmd: string) => Promise<string>
    openApp: (name: string) => Promise<string>
    getInfo: () => Promise<any>
    searchFile: (query: string) => Promise<string[]>
  }
  features: {
    setReminder: (minutes: number, message: string) => Promise<void>
    searchWeb: (query: string) => Promise<string>
    analyzeScreen: (question?: string) => Promise<string>
    focusStart: (minutes: number, task: string) => Promise<boolean>
    focusStop: () => Promise<boolean>
    focusStatus: () => Promise<{ active: boolean; task?: string; remainingMin?: number }>
  }
  window: {
    minimize: () => void
    close: () => void
    toggleOverlay: () => void
    quit: () => void
    show: () => void
    hide: () => void
  }
  on: (channel: string, callback: (...args: any[]) => void) => void
  off: (channel: string, callback: (...args: any[]) => void) => void
}

const api: DahakanAPI = {
  ai: {
    ask: (message: string) => ipcRenderer.invoke('dahakan:ask', message),
    askStream: async (message: string, onChunk: (chunk: string) => void) => {
      const id = Date.now().toString()
      const handler = (_event: any, chunk: string | null) => {
        if (chunk == null) return // stream-end sentinel, ignore
        onChunk(chunk)
      }
      ipcRenderer.on(`dahakan:stream:${id}`, handler)
      await ipcRenderer.invoke('dahakan:ask-stream', message, id)
      ipcRenderer.removeListener(`dahakan:stream:${id}`, handler)
    },
    clearHistory: () => ipcRenderer.invoke('dahakan:clear-history'),
    greeting: () => ipcRenderer.invoke('dahakan:greeting'),
    macroMatch: (message: string) => ipcRenderer.invoke('dahakan:macro-match', message)
  },
  voice: {
    startListening: () => ipcRenderer.invoke('dahakan:listen-start'),
    stopListening: () => ipcRenderer.invoke('dahakan:listen-stop'),
    sendAudioChunk: (chunk: Uint8Array) => ipcRenderer.send('dahakan:audio-chunk', chunk),
    speak: (text: string) => ipcRenderer.invoke('dahakan:speak', text),
    stopSpeaking: () => ipcRenderer.invoke('dahakan:speak-stop')
  },
  system: {
    runCommand: (cmd: string) => ipcRenderer.invoke('dahakan:system-cmd', cmd),
    openApp: (name: string) => ipcRenderer.invoke('dahakan:open-app', name),
    getInfo: () => ipcRenderer.invoke('dahakan:system-info'),
    searchFile: (query: string) => ipcRenderer.invoke('dahakan:search-file', query)
  },
  features: {
    setReminder: (minutes: number, message: string) =>
      ipcRenderer.invoke('dahakan:remind', minutes, message),
    searchWeb: (query: string) => ipcRenderer.invoke('dahakan:search-web', query),
    analyzeScreen: (question?: string) =>
      ipcRenderer.invoke('dahakan:analyze-screen', question),
    focusStart: (minutes: number, task: string) =>
      ipcRenderer.invoke('dahakan:focus-start', minutes, task),
    focusStop: () => ipcRenderer.invoke('dahakan:focus-stop'),
    focusStatus: () => ipcRenderer.invoke('dahakan:focus-status')
  },
  window: {
    minimize: () => ipcRenderer.send('dahakan:window-minimize'),
    close: () => ipcRenderer.send('dahakan:window-close'),
    toggleOverlay: () => ipcRenderer.send('dahakan:window-toggle-overlay'),
    quit: () => ipcRenderer.send('dahakan:app-quit'),
    show: () => ipcRenderer.send('dahakan:window-show'),
    hide: () => ipcRenderer.send('dahakan:window-hide')
  },
  on: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  },
  off: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback)
  }
}

contextBridge.exposeInMainWorld('dahakan', api)
