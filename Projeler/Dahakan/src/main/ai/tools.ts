import { openApplication, openUrl, runCommand } from '../system/commander'
import { getSystemInfo, formatSystemInfoForAI } from '../system/monitor'
import { searchFile } from '../system/file-manager'
import { searchWeb } from '../features/web-search'
import { analyzeScreen } from '../features/vision'
import { saveNote, listNotes, findNotes, formatNotesForAI } from '../features/notes'
import { readClipboard, writeClipboard, getActiveWindow, formatActiveWindowForAI } from '../features/context'
import { translateText, analyzeCode } from '../features/language'
import { readTextFile, listDirectory } from '../features/file-ops'
import { MacroStoreFile, formatMacrosForAI } from '../features/macros'
import { getWeather, getNewsBriefing, LifestyleTracker } from '../features/lifestyle'
import { SettingsStore } from '../features/settings'
import { formatCapabilitiesForAI, runHealthCheck } from '../features/meta'
import type { Memory } from './memory'
import type { FocusMode } from '../features/focus-mode'
import type { ConversationLog } from '../features/conversation-log'

// Lifestyle tracker + conversation log singleton'ları
let lifestyleTracker: LifestyleTracker | null = null
let conversationLog: ConversationLog | null = null
let settingsStore: SettingsStore | null = null
// Set sonrası bildirim callback'i (ipc-handlers ProactiveScheduler'ı bu sayede yeniden ayarlar)
let settingsChangedCb: ((key: string, value: unknown) => void) | null = null
export function setLifestyleTracker(t: LifestyleTracker): void { lifestyleTracker = t }
export function setConversationLog(c: ConversationLog): void { conversationLog = c }
export function setSettingsStore(s: SettingsStore): void { settingsStore = s }
export function setSettingsChangedCb(cb: (key: string, value: unknown) => void): void { settingsChangedCb = cb }

// Macro store singleton — engine startup'ta initialize edilir
let macroStore: MacroStoreFile | null = null
export function setMacroStore(m: MacroStoreFile): void {
  macroStore = m
}
export function getMacroStore(): MacroStoreFile | null {
  return macroStore
}

// ReminderManager is injected via setReminderManager since it requires a callback
interface ReminderHandle {
  addReminder: (minutes: number, message: string) => string
  getActiveReminders?: () => Array<{ id: string; message: string; remainingMinutes: number }>
}
let reminderManager: ReminderHandle | null = null

// Engine injected by engine setup — daily_briefing buradan çağırır
interface BriefingHandle {
  generateDailyBriefing: (mode: 'sabah' | 'aksam' | 'auto', extraContext?: string) => Promise<string>
}
let briefingProvider: BriefingHandle | null = null

export function setBriefingProvider(p: BriefingHandle): void {
  briefingProvider = p
}

// Memory injected by engine — remember_fact / forget_fact buradan yazar
let memory: Memory | null = null

// Odaklanma modu — start/end_focus_mode buradan kontrol eder
let focusMode: FocusMode | null = null

export function setReminderManager(manager: ReminderHandle): void {
  reminderManager = manager
}

export function setMemory(m: Memory): void {
  memory = m
}

export function setFocusMode(f: FocusMode): void {
  focusMode = f
}

export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  try {
    switch (name) {
      case 'open_application': {
        const appName = args.name as string
        if (!appName) return 'Uygulama adı belirtilmedi.'
        return await openApplication(appName)
      }

      case 'open_url': {
        const url = args.url as string
        const browser = args.browser as string | undefined
        if (!url) return 'URL belirtilmedi.'
        return await openUrl(url, browser)
      }

      case 'run_command': {
        const command = args.command as string
        if (!command) return 'Komut belirtilmedi.'
        return await runCommand(command)
      }

      case 'get_system_info': {
        const info = await getSystemInfo()
        return formatSystemInfoForAI(info)
      }

      case 'search_web': {
        const query = args.query as string
        if (!query) return 'Arama sorgusu belirtilmedi.'
        const result = await searchWeb(query)
        // Cevabı memory'ye kaydet ki kullanıcının takip soruları context'e otomatik gelsin
        if (memory && result && !result.startsWith('Web araması başarısız')) {
          memory.setLastWebContext(query, result)
        }
        return result
      }

      case 'set_reminder': {
        if (!reminderManager) {
          return 'Hatırlatıcı sistemi henüz hazır değil.'
        }
        const minutes = args.minutes as number
        const message = args.message as string
        if (!minutes || !message) return 'Dakika ve mesaj bilgisi gerekli.'
        const id = reminderManager.addReminder(minutes, message)
        return `Hatırlatıcı kuruldu: "${message}" — ${minutes} dakika sonra tetiklenecek. (ID: ${id})`
      }

      case 'find_file': {
        const filename = args.filename as string
        if (!filename) return 'Dosya adı belirtilmedi.'
        const directory = args.directory as string | undefined
        const results = await searchFile(filename, directory)
        if (results.length === 0) {
          return `"${filename}" adında dosya bulunamadı.`
        }
        return `${results.length} dosya bulundu:\n${results.join('\n')}`
      }

      case 'remember_fact': {
        if (!memory) return 'Hafıza modülü hazır değil.'
        const fact = (args.fact as string || '').trim()
        if (!fact) return 'Hatırlanacak bilgi boş.'
        const added = memory.addFact(fact)
        return added
          ? `Aklımda. ${fact}`
          : `Bu bilgi zaten hafızamda var, tekrar eklemedim.`
      }

      case 'forget_fact': {
        if (!memory) return 'Hafıza modülü hazır değil.'
        const needle = (args.needle as string || '').trim()
        if (!needle) return 'Silinecek bilginin anahtar kelimesi boş.'
        const removed = memory.forgetFact(needle)
        return removed > 0
          ? `Tamam, "${needle}" ile ilgili ${removed} bilgiyi sildim.`
          : `"${needle}" ile eşleşen bir bilgi bulamadım.`
      }

      case 'analyze_screen': {
        const question = (args.question as string || '').trim()
        const result = await analyzeScreen(question || undefined)
        return result
      }

      case 'start_focus_mode': {
        if (!focusMode) return 'Odaklanma modu hazır değil.'
        const minutes = Number(args.minutes) || 25
        const task = (args.task as string || '').trim() || 'odaklanma'
        focusMode.start(minutes, task)
        return `Odak modu başladı: ${minutes} dakika "${task}". Bittiğinde haber veririm.`
      }

      case 'end_focus_mode': {
        if (!focusMode) return 'Odaklanma modu hazır değil.'
        const wasActive = focusMode.stop()
        return wasActive ? 'Odak modu erken bitirildi.' : 'Zaten odaklanma modunda değildin.'
      }

      case 'save_note': {
        const content = (args.content as string || '').trim()
        if (!content) return 'Not içeriği boş.'
        const tag = (args.tag as string || '').trim() || undefined
        return saveNote(content, tag)
      }

      case 'find_notes': {
        const query = (args.query as string || '').trim()
        if (!query) {
          const recent = listNotes(5)
          return recent.length === 0
            ? 'Henüz hiç not yok.'
            : `En son 5 not:\n\n${formatNotesForAI(recent)}`
        }
        const matches = findNotes(query, 5)
        return matches.length === 0
          ? `"${query}" ile ilgili not bulamadım.`
          : `"${query}" için ${matches.length} not bulundu:\n\n${formatNotesForAI(matches)}`
      }

      case 'read_clipboard': {
        const text = readClipboard()
        if (!text) return 'Pano boş veya okunamadı.'
        return `Pano içeriği (${text.length} karakter):\n\n${text}`
      }

      case 'write_clipboard': {
        const text = (args.text as string || '')
        if (!text) return 'Yazılacak metin boş.'
        const ok = writeClipboard(text)
        return ok ? 'Pano güncellendi.' : 'Pano güncellenemedi.'
      }

      case 'get_active_window': {
        const info = await getActiveWindow()
        return formatActiveWindowForAI(info)
      }

      case 'translate_text': {
        const text = (args.text as string || '').trim()
        const targetLang = (args.target_lang as string || 'en').trim()
        if (!text) return 'Çevrilecek metin boş.'
        return await translateText(text, targetLang)
      }

      case 'analyze_code': {
        const code = (args.code as string || '').trim()
        const mode = ((args.mode as string || 'explain') as 'explain' | 'fix' | 'optimize' | 'review')
        const question = (args.question as string || '').trim() || undefined
        if (!code) {
          // Boşsa clipboard'a bak — kod oradadır muhtemelen
          const clip = readClipboard()
          if (!clip || clip.length < 20) return 'Analiz edilecek kod yok. Panoda da bulamadım.'
          return await analyzeCode(clip, mode, question)
        }
        return await analyzeCode(code, mode, question)
      }

      case 'read_text_file': {
        const path = (args.path as string || '').trim()
        if (!path) return 'Dosya yolu belirtilmedi.'
        return readTextFile(path)
      }

      case 'list_directory': {
        const path = (args.path as string || '').trim()
        if (!path) return 'Klasör yolu belirtilmedi.'
        return listDirectory(path)
      }

      case 'list_macros': {
        if (!macroStore) return 'Makro deposu henüz hazır değil.'
        const all = macroStore.list()
        return formatMacrosForAI(all)
      }

      case 'get_weather': {
        const location = (args.location as string || 'İstanbul').trim()
        return await getWeather(location)
      }

      case 'get_news': {
        const topic = (args.topic as string || '').trim() || undefined
        return await getNewsBriefing(topic)
      }

      case 'log_mood': {
        if (!lifestyleTracker) return 'Yaşam takip modülü hazır değil.'
        const score = Number(args.score)
        if (!score || score < 1 || score > 5) return 'Ruh hali puanı 1-5 arası olmalı.'
        const note = (args.note as string || '').trim() || undefined
        return lifestyleTracker.logMood(score, note)
      }

      case 'log_habit': {
        if (!lifestyleTracker) return 'Yaşam takip modülü hazır değil.'
        const name = (args.name as string || '').trim()
        const done = args.done !== false  // default true
        if (!name) return 'Alışkanlık adı boş.'
        return lifestyleTracker.logHabit(name, done)
      }

      case 'tracker_summary': {
        if (!lifestyleTracker) return 'Yaşam takip modülü hazır değil.'
        return lifestyleTracker.getSummary()
      }

      case 'export_conversation': {
        if (!conversationLog) return 'Sohbet log modülü hazır değil.'
        const date = (args.date as string || '').trim() || undefined
        const r = conversationLog.exportToDesktop(date)
        if (!r.ok) return `Export başarısız: ${r.reason}`
        return `Sohbet log'u Masaüstüne kaydedildi: ${r.outPath}`
      }

      case 'what_do_you_know': {
        if (!memory) return 'Hafıza modülü hazır değil.'
        const facts = memory.getFacts()
        const summary = memory.getRecentSummary()
        const web = memory.getLastWebContext()
        const lines: string[] = []
        lines.push(`Senin hakkında bildiklerim (${facts.length} bilgi):`)
        facts.forEach((f) => lines.push(`- ${f}`))
        if (summary) {
          lines.push('')
          lines.push('Son sohbetlerimizin özeti:')
          lines.push(summary)
        }
        if (web) {
          const ageMin = Math.round((Date.now() - new Date(web.fetchedAt).getTime()) / 60000)
          lines.push('')
          lines.push(`Son web aramam (${ageMin} dk önce): "${web.query}"`)
        }
        return lines.join('\n')
      }

      case 'capabilities': {
        return formatCapabilitiesForAI()
      }

      case 'health_check': {
        return runHealthCheck({
          memoryFacts: memory ? memory.getFacts().length : 0,
          notesCount: listNotes(500).length,
          conversationDays: conversationLog ? conversationLog.listAvailableDays(365).length : 0,
          focusActive: focusMode ? focusMode.isActive() : false,
        })
      }

      case 'get_settings': {
        if (!settingsStore) return 'Ayar deposu hazır değil.'
        return settingsStore.formatForAI()
      }

      case 'set_setting': {
        if (!settingsStore) return 'Ayar deposu hazır değil.'
        const key = (args.key as string || '').trim()
        const value = args.value
        if (!key) return 'Ayar adı belirtilmedi.'
        const validKeys = ['proactiveGreeting', 'autoSleepMinutes', 'proactiveCheckInHours', 'geminiRouting', 'voiceLanguage', 'defaultFocusMinutes']
        if (!validKeys.includes(key)) return `Bilinmeyen ayar: ${key}. Geçerli: ${validKeys.join(', ')}`
        try {
          settingsStore.set(key as any, value as any)
          if (settingsChangedCb) settingsChangedCb(key, value)
          return `Ayar güncellendi: ${key} = ${value}`
        } catch (err) {
          return `Ayar güncellenemedi: ${(err as Error).message}`
        }
      }

      case 'daily_briefing': {
        if (!briefingProvider) return 'Brifing motoru hazır değil.'
        const rawMode = (args.mode as string || '').toLowerCase().trim()
        let mode: 'sabah' | 'aksam' | 'auto' = 'auto'
        if (rawMode === 'sabah' || rawMode === 'morning' || rawMode === 'agenda') mode = 'sabah'
        else if (rawMode === 'akşam' || rawMode === 'aksam' || rawMode === 'evening' || rawMode === 'özet' || rawMode === 'ozet') mode = 'aksam'
        // Aktif hatırlatıcıları ek bağlam olarak ver
        let extra = ''
        if (reminderManager?.getActiveReminders) {
          const active = reminderManager.getActiveReminders()
          if (active.length > 0) {
            extra = 'AKTİF HATIRLATICILAR:\n' + active.map((r) => `- ${r.remainingMinutes} dk içinde: ${r.message}`).join('\n')
          }
        }
        return await briefingProvider.generateDailyBriefing(mode, extra)
      }

      default:
        return `Bilinmeyen araç: ${name}`
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[Dahakan Tools] "${name}" aracı çalıştırılırken hata:`, errorMsg)
    return `Araç çalıştırılırken hata oluştu: ${errorMsg}`
  }
}
