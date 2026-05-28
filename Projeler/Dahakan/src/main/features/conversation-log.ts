import { app } from 'electron'
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

const LOG_DIR_NAME = 'conversations'
const MAX_LINE_PER_TURN = 2000  // çok uzun cevaplar truncate edilir

function logsDir(): string {
  const dir = join(app.getPath('userData'), LOG_DIR_NAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function pathFor(date: Date): string {
  const ymd = date.toISOString().slice(0, 10)
  return join(logsDir(), `${ymd}.md`)
}

export class ConversationLog {
  private currentDateKey: string = ''
  private fileBootstrapped = false

  constructor() {
    this.ensureToday()
  }

  private ensureToday(): void {
    const today = new Date().toISOString().slice(0, 10)
    if (today !== this.currentDateKey) {
      this.currentDateKey = today
      this.fileBootstrapped = false
    }
    if (!this.fileBootstrapped) {
      const p = pathFor(new Date())
      if (!existsSync(p)) {
        const header = `# ${today} — Dahakan Sohbet Günlüğü\n\n`
        try { appendFileSync(p, header, 'utf-8') } catch {}
      }
      this.fileBootstrapped = true
    }
  }

  appendTurn(role: 'levent' | 'dahakan', content: string): void {
    if (!content || content.trim().length === 0) return
    this.ensureToday()
    try {
      const time = new Date().toTimeString().slice(0, 5)
      const safe = content.trim().slice(0, MAX_LINE_PER_TURN)
      const label = role === 'levent' ? 'Levent' : 'Dahakan'
      const block = `**${time} ${label}:** ${safe}\n\n`
      appendFileSync(pathFor(new Date()), block, 'utf-8')
    } catch (err) {
      console.warn('[Dahakan Log] Yazma hatası:', err)
    }
  }

  /** Bugünün log dosyasının ham markdown içeriğini döndürür. */
  readToday(): string {
    const p = pathFor(new Date())
    if (!existsSync(p)) return ''
    try {
      return readFileSync(p, 'utf-8')
    } catch {
      return ''
    }
  }

  /** Belirli bir tarihte log var mı, son N günden hangileri kayıtlı? */
  listAvailableDays(maxDays: number = 14): string[] {
    try {
      return readdirSync(logsDir())
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .map((f) => f.replace(/\.md$/, ''))
        .sort()
        .slice(-maxDays)
    } catch {
      return []
    }
  }

  /** Belirli bir tarihin logunu okur (YYYY-MM-DD); bugün için boş bırak. */
  readDay(dateKey?: string): string {
    const key = dateKey || new Date().toISOString().slice(0, 10)
    const p = join(logsDir(), `${key}.md`)
    if (!existsSync(p)) return ''
    try { return readFileSync(p, 'utf-8') } catch { return '' }
  }

  /** Verilen tarihin log'unu Masaüstüne kopyalar. */
  exportToDesktop(dateKey?: string): { ok: boolean; outPath?: string; reason?: string } {
    const key = dateKey || new Date().toISOString().slice(0, 10)
    const src = join(logsDir(), `${key}.md`)
    if (!existsSync(src)) return { ok: false, reason: `${key} için kayıt yok.` }
    try {
      const desktop = app.getPath('desktop')
      const outPath = join(desktop, `Dahakan-Sohbet-${key}.md`)
      const content = readFileSync(src, 'utf-8')
      writeFileSync(outPath, content, 'utf-8')
      return { ok: true, outPath }
    } catch (err) {
      return { ok: false, reason: (err as Error).message }
    }
  }
}
