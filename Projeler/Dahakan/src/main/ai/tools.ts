import { openApplication, openUrl, runCommand } from '../system/commander'
import { getSystemInfo, formatSystemInfoForAI } from '../system/monitor'
import { searchFile } from '../system/file-manager'
import { searchWeb } from '../features/web-search'
import type { Memory } from './memory'

// ReminderManager is injected via setReminderManager since it requires a callback
let reminderManager: { addReminder: (minutes: number, message: string) => string } | null = null

// Memory injected by engine — remember_fact / forget_fact buradan yazar
let memory: Memory | null = null

export function setReminderManager(manager: { addReminder: (minutes: number, message: string) => string }): void {
  reminderManager = manager
}

export function setMemory(m: Memory): void {
  memory = m
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
        return await searchWeb(query)
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

      default:
        return `Bilinmeyen araç: ${name}`
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[Dahakan Tools] "${name}" aracı çalıştırılırken hata:`, errorMsg)
    return `Araç çalıştırılırken hata oluştu: ${errorMsg}`
  }
}
