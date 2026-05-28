import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { setupIpcHandlers } from './ipc-handlers'

// Load environment variables as early as possible
import './utils/env-loader'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

// Komut satırı argümanından "hidden" modunu çıkar — auto-start için
const startHidden = process.argv.includes('--hidden')

function createWindow(): void {
  const iconPath = resolveIconPath()
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 300,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    show: false,
    icon: iconPath || undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Show window when ready to prevent visual flash — UNLESS started with --hidden
  mainWindow.on('ready-to-show', () => {
    if (!startHidden) {
      mainWindow?.show()
      console.log('[Dahakan] Ana pencere gösterildi')
    } else {
      console.log('[Dahakan] Gizli modda başlatıldı, tray\'de hazır')
    }
  })

  // Load the renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    console.log('[Dahakan] Dev sunucusundan yükleniyor:', process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    console.log('[Dahakan] Derlenmiş dosyadan yükleniyor')
  }

  // Setup IPC handlers
  setupIpcHandlers(mainWindow)

  // Handle window close — hide instead of quit
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Open devtools in development
  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

function resolveIconPath(): string | null {
  // Production (packaged): resources/build/icon.ico veya app.asar/build/icon.ico
  const candidates = [
    join(process.resourcesPath || '', 'build', 'icon.ico'),
    join(__dirname, '..', '..', 'build', 'icon.ico'),
    join(__dirname, '..', '..', '..', 'build', 'icon.ico'),
  ]
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return null
}

function createTray(): void {
  // Tray ikonu — proje icon.ico'sunu dene, yoksa fallback boş
  const iconPath = resolveIconPath()
  let icon
  if (iconPath) {
    icon = nativeImage.createFromPath(iconPath)
    if (!icon.isEmpty()) {
      // Tray için küçük boyut
      icon = icon.resize({ width: 16, height: 16 })
    }
  }
  if (!icon || icon.isEmpty()) {
    icon = nativeImage.createEmpty()
  }
  tray = new Tray(icon)

  const send = (channel: string, ...args: unknown[]) => {
    if (mainWindow) mainWindow.webContents.send(channel, ...args)
  }
  const showAndSend = (channel: string, ...args: unknown[]) => {
    if (!mainWindow) return
    if (!mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
    mainWindow.webContents.send(channel, ...args)
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Dahakan\'ı Göster',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    {
      label: 'Gizle',
      click: () => {
        mainWindow?.hide()
      }
    },
    { type: 'separator' },
    {
      label: 'Ekrana Bak (Vision)',
      click: () => showAndSend('dahakan:vision-hotkey')
    },
    {
      label: 'Mikrofonu Kıs/Aç (Ctrl+Shift+M)',
      click: () => send('dahakan:mute-hotkey')
    },
    {
      label: 'Brifing İste',
      click: () => showAndSend('dahakan:tray-briefing')
    },
    {
      label: 'Odak Modu Başlat (25dk)',
      click: () => showAndSend('dahakan:tray-focus-start')
    },
    {
      label: 'Odak Modunu Bitir',
      click: () => showAndSend('dahakan:tray-focus-stop')
    },
    { type: 'separator' },
    {
      label: 'Çıkış',
      click: () => {
        (app as any).isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setToolTip('Dahakan — AI Asistan')
  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })
}

function registerGlobalShortcuts(): void {
  // Ctrl+Shift+D to toggle window visibility
  const registered = globalShortcut.register('Ctrl+Shift+D', () => {
    if (!mainWindow) return

    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  if (!registered) {
    console.warn('[Dahakan] Ctrl+Shift+D kısayolu kaydedilemedi')
  } else {
    console.log('[Dahakan] Global kısayol kaydedildi: Ctrl+Shift+D')
  }

  // Ctrl+Shift+V — ekranı analiz et (Vision mode). Pencereyi gösterir ki cevap görünsün.
  const visionReg = globalShortcut.register('Ctrl+Shift+V', () => {
    if (!mainWindow) return
    if (!mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
    mainWindow.webContents.send('dahakan:vision-hotkey')
  })
  if (visionReg) {
    console.log('[Dahakan] Global kısayol kaydedildi: Ctrl+Shift+V (Vision)')
  } else {
    console.warn('[Dahakan] Ctrl+Shift+V kısayolu kaydedilemedi (başka uygulama tutuyor olabilir)')
  }

  // Ctrl+Shift+M — mikrofonu sustur/aç (continuous mode dinlemesi)
  const muteReg = globalShortcut.register('Ctrl+Shift+M', () => {
    if (!mainWindow) return
    mainWindow.webContents.send('dahakan:mute-hotkey')
  })
  if (muteReg) {
    console.log('[Dahakan] Global kısayol kaydedildi: Ctrl+Shift+M (Mic mute)')
  } else {
    console.warn('[Dahakan] Ctrl+Shift+M kısayolu kaydedilemedi')
  }
}

// ─── App Lifecycle ───────────────────────────────────

app.whenReady().then(() => {
  console.log('[Dahakan] Uygulama başlatılıyor...', startHidden ? '(hidden mode)' : '')

  // Windows boot'ta otomatik başlat — tray'de gizli
  if (process.platform === 'win32' && app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true,
      args: ['--hidden']
    })
  }

  createWindow()
  createTray()
  registerGlobalShortcuts()

  app.on('activate', () => {
    // On macOS re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  console.log('[Dahakan] Uygulama hazır')
})

app.on('window-all-closed', () => {
  // On macOS, don't quit when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll()
  console.log('[Dahakan] Kısayollar temizlendi')
})

app.on('before-quit', () => {
  (app as any).isQuitting = true
})

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}
