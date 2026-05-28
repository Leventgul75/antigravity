import { app, ipcMain, BrowserWindow } from 'electron'
import { AIEngine } from './ai/engine'
import { setReminderManager, setFocusMode, setSettingsChangedCb } from './ai/tools'
import { SpeechToText } from './voice/stt'
import { TextToSpeech } from './voice/tts'
import { AudioCapture } from './voice/audio-capture'
import { ReminderManager } from './features/reminders'
import { searchWeb } from './features/web-search'
import { analyzeScreen } from './features/vision'
import { FocusMode } from './features/focus-mode'
import { ProactiveScheduler } from './features/proactive'
import { openApplication, runCommand } from './system/commander'
import { getSystemInfo } from './system/monitor'
import { searchFile } from './system/file-manager'

let isOverlayMode = false

export function setupIpcHandlers(mainWindow: BrowserWindow): void {
  // Initialize all modules
  const aiEngine = new AIEngine()
  const stt = new SpeechToText()
  const tts = new TextToSpeech()
  const audioCapture = new AudioCapture()
  // Settings'ten dil çek + STT'yi ayarla
  stt.setLanguage(aiEngine.settings.get().voiceLanguage)

  const reminderManager = new ReminderManager((message: string) => {
    // Renderer'a bildir — chat'te göstersin
    mainWindow.webContents.send('dahakan:reminder-triggered', message)
    // Dahakan sesli olarak söylesin — Notification yetmez, arkadaş gibi konuş
    void (async () => {
      try {
        const spoken = `Hatırlatma: ${message}`
        const audioBuffer = await tts.synthesize(spoken)
        mainWindow.webContents.send('dahakan:audio-play', audioBuffer)
      } catch (err) {
        console.warn('[Dahakan Reminder] Sesli okuma başarısız:', err)
      }
    })()
  })

  const focusMode = new FocusMode((active: boolean, task: string) => {
    mainWindow.webContents.send('dahakan:focus-changed', { active, task })
  })

  // Proaktif check-in: Settings'ten saat oranını al, mesaj geldiğinde TTS + renderer'a yansıt
  const proactive = new ProactiveScheduler({
    intervalHours: aiEngine.settings.get().proactiveCheckInHours,
    onMessage: (text: string) => {
      mainWindow.webContents.send('dahakan:proactive-message', text)
      void (async () => {
        try {
          const audioBuffer = await tts.synthesize(text)
          mainWindow.webContents.send('dahakan:audio-play', audioBuffer)
        } catch (err) {
          console.warn('[Dahakan Proactive] TTS hatası:', err)
        }
      })()
    },
  })

  // Inject reminder + focus mode into tools
  setReminderManager(reminderManager)
  setFocusMode(focusMode)
  // Set callback: AI set_setting çağırınca proactive scheduler + STT lang güncellensin
  setSettingsChangedCb((key, value) => {
    if (key === 'proactiveCheckInHours') {
      proactive.setIntervalHours(Number(value) || 0)
    }
    if (key === 'voiceLanguage') {
      stt.setLanguage(String(value || 'tr'))
    }
  })

  console.log('[Dahakan IPC] Handler\'lar kaydediliyor...')

  // ─── AI ────────────────────────────────────────────

  ipcMain.handle('dahakan:ask', async (_event, message: string) => {
    try {
      return await aiEngine.ask(message)
    } catch (error) {
      console.error('[Dahakan IPC] ask hatası:', error)
      return 'Bir hata oluştu efendim.'
    }
  })

  ipcMain.handle('dahakan:ask-stream', async (_event, message: string, id: string) => {
    try {
      await aiEngine.askStream(message, (chunk: string) => {
        mainWindow.webContents.send(`dahakan:stream:${id}`, chunk)
      })
      // Signal stream end
      mainWindow.webContents.send(`dahakan:stream:${id}`, null)
    } catch (error) {
      console.error('[Dahakan IPC] ask-stream hatası:', error)
      mainWindow.webContents.send(`dahakan:stream:${id}`, 'Bir hata oluştu efendim.')
      mainWindow.webContents.send(`dahakan:stream:${id}`, null)
    }
  })

  ipcMain.handle('dahakan:clear-history', async () => {
    aiEngine.clearHistory()
    return true
  })

  ipcMain.handle('dahakan:greeting', async () => {
    try {
      return await aiEngine.generateGreeting()
    } catch (err) {
      console.error('[Dahakan IPC] greeting hatası:', err)
      return 'Buradayım, dinliyorum.'
    }
  })

  // Makro intent algılama — renderer her kullanıcı utterance'ı için sorar
  ipcMain.handle('dahakan:macro-match', async (_event, message: string) => {
    try {
      return aiEngine.findMatchingMacroSteps(message)
    } catch (err) {
      console.error('[Dahakan IPC] macro-match hatası:', err)
      return null
    }
  })

  // Settings güncellenirse proaktif scheduler'ı yeniden ayarla
  ipcMain.handle('dahakan:settings-update', async (_event, key: string, value: unknown) => {
    try {
      aiEngine.settings.set(key as any, value as any)
      // Proaktif check-in saat değişirse yeniden zamanla
      if (key === 'proactiveCheckInHours') {
        proactive.setIntervalHours(Number(value) || 0)
      }
      return true
    } catch (err) {
      console.error('[Dahakan IPC] settings-update hatası:', err)
      return false
    }
  })

  ipcMain.handle('dahakan:settings-get', async () => {
    return aiEngine.settings.get()
  })

  // ─── Vision ────────────────────────────────────────

  ipcMain.handle('dahakan:analyze-screen', async (_event, question?: string) => {
    try {
      return await analyzeScreen(question)
    } catch (err) {
      console.error('[Dahakan IPC] analyze-screen hatası:', err)
      return 'Ekran analizinde hata oldu.'
    }
  })

  // ─── Focus ─────────────────────────────────────────

  ipcMain.handle('dahakan:focus-start', async (_event, minutes: number, task: string) => {
    focusMode.start(minutes, task)
    return true
  })

  ipcMain.handle('dahakan:focus-stop', async () => {
    return focusMode.stop()
  })

  ipcMain.handle('dahakan:focus-status', async () => {
    return focusMode.status()
  })

  // ─── Voice ─────────────────────────────────────────

  ipcMain.on('dahakan:audio-chunk', (_event, chunk: Uint8Array) => {
    audioCapture.addChunk(Buffer.from(chunk))
  })

  ipcMain.handle('dahakan:listen-start', async () => {
    try {
      audioCapture.startRecording()
      return true
    } catch (error) {
      console.error('[Dahakan IPC] listen-start hatası:', error)
      return false
    }
  })

  ipcMain.handle('dahakan:listen-stop', async () => {
    try {
      const audioBuffer = await audioCapture.stopRecording()
      if (audioBuffer.length === 0) {
        return ''
      }
      const transcript = await stt.transcribe(audioBuffer)
      return transcript
    } catch (error) {
      console.error('[Dahakan IPC] listen-stop hatası:', error)
      return ''
    }
  })

  ipcMain.handle('dahakan:speak', async (_event, text: string) => {
    try {
      const audioBuffer = await tts.synthesize(text)
      // Send audio buffer to renderer for playback
      mainWindow.webContents.send('dahakan:audio-play', audioBuffer)
      return true
    } catch (error) {
      console.error('[Dahakan IPC] speak hatası:', error)
      return false
    }
  })

  ipcMain.handle('dahakan:speak-stop', async () => {
    try {
      mainWindow.webContents.send('dahakan:audio-stop')
      return true
    } catch (error) {
      console.error('[Dahakan IPC] speak-stop hatası:', error)
      return false
    }
  })

  // ─── System ────────────────────────────────────────

  ipcMain.handle('dahakan:system-cmd', async (_event, cmd: string) => {
    try {
      return await runCommand(cmd)
    } catch (error) {
      console.error('[Dahakan IPC] system-cmd hatası:', error)
      return 'Komut çalıştırılamadı.'
    }
  })

  ipcMain.handle('dahakan:open-app', async (_event, name: string) => {
    try {
      return await openApplication(name)
    } catch (error) {
      console.error('[Dahakan IPC] open-app hatası:', error)
      return 'Uygulama açılamadı.'
    }
  })

  ipcMain.handle('dahakan:system-info', async () => {
    try {
      return await getSystemInfo()
    } catch (error) {
      console.error('[Dahakan IPC] system-info hatası:', error)
      return null
    }
  })

  ipcMain.handle('dahakan:search-file', async (_event, query: string) => {
    try {
      return await searchFile(query)
    } catch (error) {
      console.error('[Dahakan IPC] search-file hatası:', error)
      return []
    }
  })

  // ─── Features ──────────────────────────────────────

  ipcMain.handle('dahakan:remind', async (_event, minutes: number, message: string) => {
    try {
      const id = reminderManager.addReminder(minutes, message)
      return id
    } catch (error) {
      console.error('[Dahakan IPC] remind hatası:', error)
      return null
    }
  })

  ipcMain.handle('dahakan:search-web', async (_event, query: string) => {
    try {
      return await searchWeb(query)
    } catch (error) {
      console.error('[Dahakan IPC] search-web hatası:', error)
      return 'Web araması başarısız oldu.'
    }
  })

  // ─── Window Controls ──────────────────────────────

  ipcMain.on('dahakan:window-show', () => {
    try {
      mainWindow.show()
      mainWindow.focus()
    } catch (error) {
      console.error('[Dahakan IPC] window-show hatası:', error)
    }
  })

  ipcMain.on('dahakan:window-hide', () => {
    try {
      mainWindow.hide()
    } catch (error) {
      console.error('[Dahakan IPC] window-hide hatası:', error)
    }
  })

  ipcMain.on('dahakan:window-minimize', () => {
    try {
      mainWindow.minimize()
    } catch (error) {
      console.error('[Dahakan IPC] window-minimize hatası:', error)
    }
  })

  ipcMain.on('dahakan:window-close', () => {
    try {
      mainWindow.close()
    } catch (error) {
      console.error('[Dahakan IPC] window-close hatası:', error)
    }
  })

  ipcMain.on('dahakan:app-quit', () => {
    console.log('[Dahakan IPC] Tam kapatma istendi, çıkılıyor...')
    ;(app as any).isQuitting = true
    // Verir kısa süre, sonra app.quit() ile electron-vite dev de sonlanır
    setTimeout(() => app.quit(), 100)
  })

  ipcMain.on('dahakan:window-toggle-overlay', () => {
    try {
      isOverlayMode = !isOverlayMode
      mainWindow.setAlwaysOnTop(isOverlayMode, 'floating')

      if (isOverlayMode) {
        mainWindow.setIgnoreMouseEvents(false)
        mainWindow.setVisibleOnAllWorkspaces(true)
      } else {
        mainWindow.setVisibleOnAllWorkspaces(false)
      }

      mainWindow.webContents.send('dahakan:overlay-changed', isOverlayMode)
      console.log(`[Dahakan IPC] Overlay modu: ${isOverlayMode ? 'AÇIK' : 'KAPALI'}`)
    } catch (error) {
      console.error('[Dahakan IPC] window-toggle-overlay hatası:', error)
    }
  })

  console.log('[Dahakan IPC] Tüm handler\'lar kaydedildi')
}
