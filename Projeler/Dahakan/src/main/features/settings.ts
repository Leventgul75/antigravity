import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface DahakanSettings {
  proactiveGreeting: boolean        // Açılışta TTS karşılama oku mu?
  autoSleepMinutes: number          // Continuous mode'da N dk sessizlikte uyuru (0 = kapalı)
  proactiveCheckInHours: number     // 0 = kapalı, X saat: rastgele 0-X saat içinde Dahakan kontrol mesajı atar
  geminiRouting: boolean            // Araştırma sorularını Gemini'ye yönlendir
  voiceLanguage: string             // Whisper STT dili (tr/en/de vs.)
  defaultFocusMinutes: number       // Pomodoro varsayılan
  version: number
}

const DEFAULTS: DahakanSettings = {
  proactiveGreeting: true,
  autoSleepMinutes: 10,
  proactiveCheckInHours: 0,    // Default kapalı — kullanıcı açar
  geminiRouting: true,
  voiceLanguage: 'tr',
  defaultFocusMinutes: 25,
  version: 1,
}

export class SettingsStore {
  private filePath: string
  private current: DahakanSettings

  constructor() {
    this.filePath = join(app.getPath('userData'), 'dahakan-settings.json')
    this.current = this.load()
  }

  private load(): DahakanSettings {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<DahakanSettings>
        // Geriye dönük uyumluluk — eksik alanlar default'la doldur
        return { ...DEFAULTS, ...parsed }
      } catch (err) {
        console.warn('[Dahakan Settings] Yükleme hatası, defaultlar:', err)
      }
    }
    this.persist(DEFAULTS)
    return { ...DEFAULTS }
  }

  private persist(s: DahakanSettings): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(s, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Dahakan Settings] Kaydedilemedi:', err)
    }
  }

  get(): DahakanSettings {
    return { ...this.current }
  }

  set<K extends keyof DahakanSettings>(key: K, value: DahakanSettings[K]): void {
    this.current[key] = value
    this.persist(this.current)
    console.log(`[Dahakan Settings] ${key} = ${value}`)
  }

  updateMany(updates: Partial<DahakanSettings>): void {
    this.current = { ...this.current, ...updates }
    this.persist(this.current)
  }

  formatForAI(): string {
    const s = this.current
    return [
      'Aktif ayarların:',
      `- Açılışta sesli karşılama: ${s.proactiveGreeting ? 'açık' : 'kapalı'}`,
      `- Otomatik uyku: ${s.autoSleepMinutes > 0 ? s.autoSleepMinutes + ' dk sonra' : 'kapalı'}`,
      `- Proaktif check-in: ${s.proactiveCheckInHours > 0 ? 'her ' + s.proactiveCheckInHours + ' saatte bir' : 'kapalı'}`,
      `- Gemini akıllı yönlendirme: ${s.geminiRouting ? 'açık' : 'kapalı'}`,
      `- STT dili: ${s.voiceLanguage}`,
      `- Varsayılan odak süresi: ${s.defaultFocusMinutes} dk`,
    ].join('\n')
  }
}
