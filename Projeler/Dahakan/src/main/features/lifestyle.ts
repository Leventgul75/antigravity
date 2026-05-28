import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { searchWeb } from './web-search'

export async function getWeather(location: string): Promise<string> {
  const place = location.trim() || 'İstanbul'
  const query = `${place} için bugünün hava durumu: derece (santigrat), genel durum (güneşli/yağmurlu vb), rüzgâr, nem, hissedilen sıcaklık. Sadece veriyi ver, kısa ve net Türkçe. Bilmediğin kısımları söyleme, atla. Markdown KULLANMA.`
  const result = await searchWeb(query)
  return result || `${place} için hava bilgisi alınamadı.`
}

export async function getNewsBriefing(topic?: string): Promise<string> {
  const t = (topic || 'Türkiye').trim()
  const query = `Bugünün ${t} ile ilgili en önemli 3-4 haber başlığı ve birer cümle özet. Sadece somut, doğrulanmış başlıklar. Markdown KULLANMA, doğal cümleler kur.`
  const result = await searchWeb(query)
  return result || 'Haber özeti alınamadı.'
}

interface MoodEntry {
  date: string       // YYYY-MM-DD
  score: number      // 1-5
  note?: string
  timestamp: string  // ISO
}

interface HabitEntry {
  date: string       // YYYY-MM-DD
  name: string       // habit adı (slugified)
  done: boolean
  timestamp: string
}

interface TrackerStore {
  moods: MoodEntry[]
  habits: HabitEntry[]
  version: number
}

const MAX_ENTRIES = 365  // 1 yıl

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export class LifestyleTracker {
  private filePath: string
  private store: TrackerStore

  constructor() {
    this.filePath = join(app.getPath('userData'), 'dahakan-lifestyle.json')
    this.store = this.load()
  }

  private load(): TrackerStore {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw) as TrackerStore
        if (parsed && Array.isArray(parsed.moods) && Array.isArray(parsed.habits)) {
          return parsed
        }
      } catch (err) {
        console.warn('[Dahakan Tracker] Yükleme hatası:', err)
      }
    }
    const fresh: TrackerStore = { moods: [], habits: [], version: 1 }
    this.persist(fresh)
    return fresh
  }

  private persist(s: TrackerStore): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(s, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Dahakan Tracker] Kaydedilemedi:', err)
    }
  }

  logMood(score: number, note?: string): string {
    const s = Math.max(1, Math.min(5, Math.round(score)))
    const today = todayKey()
    // Bugünün önceki kaydını üstüne yaz
    this.store.moods = this.store.moods.filter((m) => m.date !== today)
    this.store.moods.push({
      date: today,
      score: s,
      note: note?.trim() || undefined,
      timestamp: new Date().toISOString(),
    })
    if (this.store.moods.length > MAX_ENTRIES) {
      this.store.moods.shift()
    }
    this.persist(this.store)
    const labels = ['', 'çok kötü', 'kötü', 'orta', 'iyi', 'harika']
    return `Bugünkü ruh halin: ${s}/5 (${labels[s]})${note ? ` — "${note}"` : ''}. Kaydedildi.`
  }

  logHabit(name: string, done: boolean): string {
    const n = name.trim().toLowerCase()
    if (n.length === 0) return 'Alışkanlık adı boş.'
    const today = todayKey()
    this.store.habits = this.store.habits.filter((h) => !(h.date === today && h.name === n))
    this.store.habits.push({
      date: today,
      name: n,
      done,
      timestamp: new Date().toISOString(),
    })
    if (this.store.habits.length > MAX_ENTRIES * 5) {
      this.store.habits.shift()
    }
    this.persist(this.store)
    return done
      ? `Tebrikler — "${n}" alışkanlığını bugün de yaptın.`
      : `Tamam, "${n}" alışkanlığını bugün yapmadığını not aldım.`
  }

  /** Son 7 gün için ruh hali ortalaması + en sık alışkanlıklar. */
  getSummary(): string {
    const today = new Date()
    const cutoff = new Date(today.getTime() - 6 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const recentMoods = this.store.moods.filter((m) => m.date >= cutoff)
    const recentHabits = this.store.habits.filter((h) => h.date >= cutoff)

    const lines: string[] = []
    if (recentMoods.length === 0) {
      lines.push('Son 7 günde ruh hali kaydı yok.')
    } else {
      const avg = recentMoods.reduce((sum, m) => sum + m.score, 0) / recentMoods.length
      const labels = ['', 'çok kötü', 'kötü', 'orta', 'iyi', 'harika']
      lines.push(`Son 7 günün ruh hali ortalaması: ${avg.toFixed(1)}/5 (${labels[Math.round(avg)]}).`)
      const lastTwo = recentMoods.slice(-2).map((m) => `${m.date}: ${m.score}/5${m.note ? ' — ' + m.note : ''}`)
      if (lastTwo.length > 0) lines.push('Son notlar: ' + lastTwo.join(' | '))
    }

    if (recentHabits.length === 0) {
      lines.push('Son 7 günde alışkanlık kaydı yok.')
    } else {
      const counts: Record<string, { done: number; total: number }> = {}
      for (const h of recentHabits) {
        if (!counts[h.name]) counts[h.name] = { done: 0, total: 0 }
        counts[h.name].total++
        if (h.done) counts[h.name].done++
      }
      const top = Object.entries(counts)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 4)
        .map(([name, c]) => `${name}: ${c.done}/${c.total}`)
      if (top.length > 0) lines.push('Takip ettiklerin: ' + top.join(', '))
    }
    return lines.join('\n')
  }
}
